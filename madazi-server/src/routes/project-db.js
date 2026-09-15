// 项目数据库管理（轻量版）：工作台右侧栏「数据库」tab 的后端
// 数据链路：wb-src DatabasePanel → /api/projects/:id/db/* → preview Pod 内 psql
// 预览 Pod 的 postgres 只监听 localhost（listen_addresses='localhost'），server 不可直连，
// 故复用 execPreviewPodCommand（k8s exec）在 Pod 内以 postgres 用户跑 psql。
// SQL 经 base64 传给 stdin 执行，避开 shell 单/双引号转义地狱。
// v1 只读：仅允许 SELECT/SHOW/EXPLAIN 等查询（数据浏览 + 表列表），写操作后续再评估。
import { Router } from 'express';
import path from 'path';
import { db } from '../db/init.js';
import { auth } from '../middleware/auth.js';
import { projectAccess } from '../middleware/permission.js';
import { execPreviewPodCommand } from '../services/terminal-k8s.js';

const router = Router();

// 只读 SQL 前缀（v1 轻量版）
const READONLY_RE = /^\s*(select|show|explain|describe|desc|table)\b/i;

router.use(auth);
router.use(projectAccess);

// preview Pod 内项目目录名 = 项目 source_path 的 basename（terminal.js 同源逻辑）
async function projectDirNameOf(projectId) {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  return rows[0]?.source_path ? path.basename(rows[0].source_path) : null;
}

// 在 preview Pod 内执行 psql（SQL 经 base64 写临时文件，psql -f 读——避开 tty 下 stdin 被劫持）
// ★ 不用 `echo | base64 -d | su -c "psql"` 管道：exec 是 tty 模式，su 会劫持 stdin，
//   无 -c 的 psql 从 tty 读 → 进入交互模式卡到超时。写文件 + -f 完全绕开 stdin。
// withHeader=false：-t 无列头（表列表）；true：首行为列头（查询）
async function psqlRun(projectId, sql, { withHeader = false } = {}) {
  const projectDirName = await projectDirNameOf(projectId);
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  const flags = withHeader ? "-A -F'|'" : "-t -A -F'|'";
  const cmd = `echo '${b64}' | base64 -d > /tmp/madazi-db.sql && su postgres -c "psql -U postgres -d appdb ${flags} -f /tmp/madazi-db.sql" 2>&1`;
  const { code, output } = await execPreviewPodCommand(projectId, cmd, { projectDirName, timeoutMs: 30000 });
  return { code, output: String(output || '') };
}

// 表列表（当前项目 appdb 的 public schema 表）
// ★ 路径用 /:id/db/*（标准挂载 /api/projects），不用 app.use mount 参数（子路由拿不到 req.params.id）
router.get('/:id/db/tables', async (req, res) => {
  const projectId = req.params.id;
  try {
    const { output } = await psqlRun(
      projectId,
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    );
    const tables = output.split('\n').map((s) => s.trim()).filter(Boolean);
    return res.json({ ok: true, tables });
  } catch (e) {
    return res.status(502).json({ error: `数据库不可达（预览未启动？）：${(e && e.message) || e}` });
  }
});

// ── 结构化 schema（表/列/主键/外键/注释/估算行数）──────────────────────────
// 供前端「数据表」浏览器 + 「关系图」视图使用。psql 输出 json 单行，parse 即用。
// ★ v2：4 个 json_agg 子查询用 json_build_object 合并为一次 psql（原 4 次串行 exec → 1 次，
//   每次 exec 走 k8s WebSocket 约百毫秒，合并后切视图/刷新的感知延迟大幅下降）。
async function dbSchema(projectId) {
  const sql = `SELECT json_build_object(
    'tables', COALESCE((SELECT json_agg(x) FROM (
      SELECT c.relname AS name,
             COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment,
             CASE WHEN c.reltuples < 0 THEN 0 ELSE c.reltuples::bigint END AS est_rows
      FROM pg_class c
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
      ORDER BY c.relname
    ) x), '[]'::json),
    'columns', COALESCE((SELECT json_agg(x) FROM (
      SELECT table_name, column_name, data_type,
             (is_nullable = 'YES') AS nullable,
             column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    ) x), '[]'::json),
    'pks', COALESCE((SELECT json_agg(x) FROM (
      SELECT t.relname AS table_name, a.attname AS column_name
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE i.indisprimary AND n.nspname = 'public'
      ORDER BY t.relname, k.ord
    ) x), '[]'::json),
    'fks', COALESCE((SELECT json_agg(x) FROM (
      SELECT con.conname AS name,
             (SELECT c.relname FROM pg_class c WHERE c.oid = con.conrelid) AS from_table,
             (SELECT c.relname FROM pg_class c WHERE c.oid = con.confrelid) AS to_table,
             (SELECT json_agg(attname ORDER BY k.ord)
                FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS from_columns,
             (SELECT json_agg(attname ORDER BY k.ord)
                FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS to_columns
      FROM pg_constraint con
      WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
      ORDER BY con.conname
    ) x), '[]'::json)
  )::text`;

  const { code, output } = await psqlRun(projectId, sql);
  const text = String(output || '').trim();
  if (code !== 0 || !text || text === 'null') return { tables: [], relations: [] };
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return { tables: [], relations: [] };
  }
  const tables = Array.isArray(v.tables) ? v.tables : [];
  const columns = Array.isArray(v.columns) ? v.columns : [];
  const pks = Array.isArray(v.pks) ? v.pks : [];
  const fks = Array.isArray(v.fks) ? v.fks : [];

  // 装配：列按表聚合 + 标主键
  const colMap = new Map();
  for (const c of columns) {
    if (!colMap.has(c.table_name)) colMap.set(c.table_name, []);
    colMap.get(c.table_name).push({
      name: c.column_name,
      type: c.data_type,
      nullable: !!c.nullable,
      default: c.column_default || null,
      pk: false,
    });
  }
  const pkSet = new Set((pks || []).map((p) => `${p.table_name}.${p.column_name}`));
  for (const [t, cols] of colMap) {
    for (const col of cols) col.pk = pkSet.has(`${t}.${col.name}`);
  }

  return {
    tables: (tables || []).map((t) => ({
      name: t.name,
      comment: t.comment || '',
      estRows: t.est_rows ?? 0,
      columns: colMap.get(t.name) || [],
    })),
    relations: (fks || []).map((f) => ({
      name: f.name,
      fromTable: f.from_table,
      fromColumns: f.from_columns || [],
      toTable: f.to_table,
      toColumns: f.to_columns || [],
    })),
  };
}

// 结构化 schema（表列表 + ER 关系图数据）
router.get('/:id/db/schema', async (req, res) => {
  const projectId = req.params.id;
  try {
    const schema = await dbSchema(projectId);
    return res.json({ ok: true, schema });
  } catch (e) {
    return res.status(502).json({ error: `数据库不可达（预览未启动？）：${(e && e.message) || e}` });
  }
});

// SQL 查询（只读）
router.post('/:id/db/query', async (req, res) => {
  const projectId = req.params.id;
  const sql = String((req.body && req.body.sql) || '').trim();
  if (!sql) return res.status(400).json({ error: 'SQL 不能为空' });
  if (!READONLY_RE.test(sql)) {
    return res.status(403).json({ error: '只读模式：仅支持 SELECT / SHOW / EXPLAIN 等查询' });
  }
  try {
    const { code, output } = await psqlRun(projectId, sql, { withHeader: true });
    if (code !== 0 || /^\s*ERROR/i.test(output)) {
      return res.json({ ok: false, error: output.trim() || `psql 退出码 ${code}` });
    }
    // -A 下 psql 会在末尾打 "(N rows)" 尾注，过滤掉避免脏行
    const lines = output.split('\n').filter((s) => s.trim() !== '' && !/^\(\d+ row/i.test(s.trim()));
    const rows = lines.map((l) => l.split('|'));
    return res.json({ ok: true, columns: rows[0] || [], rows: rows.slice(1) });
  } catch (e) {
    return res.status(502).json({ error: `数据库不可达（预览未启动？）：${(e && e.message) || e}` });
  }
});

// ── 表数据浏览（分页 + 列排序 + 真实行数）────────────────────────────────
// 单次 psql exec：\echo 标记分隔 count / data 两个结果集；\pset tuples_only 控制
//   count 段无列头、data 段恒有列头（空表也能拿到列名）。-A 下 psql 会带 "(N rows)"
//   尾注，解析时按 ^\(\d+ row 过滤。
// 排序列白名单来自 information_schema（防注入）；表名/列名均按标识符引用。
router.get('/:id/db/table-data', async (req, res) => {
  const projectId = req.params.id;
  const table = String(req.query.table || '').trim();
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10) || 50));
  const sortDir = String(req.query.sortDir || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const sortCol = String(req.query.sortCol || '').trim();
  if (!table || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(table)) {
    return res.status(400).json({ error: '非法表名' });
  }
  try {
    // 排序列白名单：仅允许该表真实存在的列（防注入）
    let orderSql = '';
    if (sortCol) {
      const safeTable = table.replace(/'/g, "''");
      const { output: colOut } = await psqlRun(
        projectId,
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${safeTable}'`
      );
      const validCols = new Set(colOut.split('\n').map((s) => s.trim()).filter(Boolean));
      if (validCols.has(sortCol)) {
        orderSql = ` ORDER BY "${sortCol.replace(/"/g, '""')}" ${sortDir}`;
      }
    }
    const quoted = `"${table.replace(/"/g, '""')}"`;
    const offset = (page - 1) * pageSize;
    const sql = `\\pset tuples_only on\n\\echo __COUNT__\nSELECT count(*) FROM ${quoted};\n\\pset tuples_only off\n\\echo __DATA__\nSELECT * FROM ${quoted}${orderSql} LIMIT ${pageSize} OFFSET ${offset};`;
    const { output } = await psqlRun(projectId, sql, { withHeader: true });
    const lines = String(output || '').split('\n').map((s) => s.trim());
    const iCount = lines.indexOf('__COUNT__');
    const iData = lines.indexOf('__DATA__');
    let count = 0;
    if (iCount >= 0 && iData > iCount) {
      count = parseInt(lines[iCount + 1], 10) || 0;
    }
    const dataLines = iData >= 0
      ? lines.slice(iData + 1).filter((s) => s !== '' && !/^\(\d+ row/i.test(s))
      : [];
    const columns = (dataLines[0] || '').split('|').filter(Boolean);
    const rows = dataLines.slice(1).map((l) => l.split('|'));
    return res.json({ ok: true, table, count, columns, rows, page, pageSize, sortCol, sortDir });
  } catch (e) {
    return res.status(502).json({ error: `数据库不可达（预览未启动？）：${(e && e.message) || e}` });
  }
});

export default router;
