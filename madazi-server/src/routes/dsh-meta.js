// ★ dsh-web 多人元数据：会话创建人 / 消息发送人 / 项目会话排序模式
// 背景：dsh-web 为全平台共享单实例，session 与消息本身无平台用户身份。
// 客户端插件（浏览器 cookie 身份）在创建会话/发送消息时上报归属，
// 侧栏任务行与对话气泡据此显示创建人/发送人。
import { Router } from 'express';
import { db } from '../db/init.js';
import { auth } from '../middleware/auth.js';
import { getProjectRole } from '../middleware/permission.js';
import { bumpAccessMap, onAccessMapChanged } from '../services/access-map-events.js';

const router = Router();

const SORT_MODES = new Set(['time', 'creator', 'manual']);
const MAX_PREFIX = 40;

// 统一成员校验：系统管理员/owner/项目成员（shared 只读用户不可写元数据）
async function requireMembership(req, res) {
  const { projectId } = req.body || req.params || {};
  if (!projectId || typeof projectId !== 'string' || projectId.length > 64) {
    res.status(400).json({ error: '缺少 projectId' });
    return null;
  }
  const role = await getProjectRole(req.user.id, projectId);
  if (!role || role === 'shared') {
    res.status(403).json({ error: '无权访问该项目' });
    return null;
  }
  return projectId;
}

// 记录会话创建人（ON CONFLICT 不覆盖——先到先得，fork/重开不改变归属）
router.post('/session-owner', auth, async (req, res) => {
  const projectId = await requireMembership(req, res);
  if (!projectId) return;
  const { sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) {
    return res.status(400).json({ error: '缺少 sessionId' });
  }
  const result = await db.query(
    `INSERT INTO dsh_session_owners (session_id, project_id, user_id)
     VALUES ($1, $2, $3) ON CONFLICT (session_id) DO NOTHING`,
    [sessionId, projectId, req.user.id]
  );
  if (result.rowCount > 0) bumpAccessMap(); // 新归属登记 → 推送权限映射变更
  res.json({ ok: true });
});

// 记录消息发送人（rpcId = dsh 客户端 prompt 请求 id，消息级唯一；
// text_prefix 用于气泡 DOM 与消息对齐——官方气泡无 message id 可寻址）
router.post('/message-sender', auth, async (req, res) => {
  const projectId = await requireMembership(req, res);
  if (!projectId) return;
  const { rpcId, sessionId, textPrefix } = req.body || {};
  if (!rpcId || typeof rpcId !== 'string' || rpcId.length > 128) {
    return res.status(400).json({ error: '缺少 rpcId' });
  }
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) {
    return res.status(400).json({ error: '缺少 sessionId' });
  }
  const prefix = String(textPrefix || '').slice(0, MAX_PREFIX);
  await db.query(
    `INSERT INTO dsh_message_senders (rpc_id, session_id, project_id, user_id, text_prefix)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (rpc_id) DO NOTHING`,
    [rpcId, sessionId, projectId, req.user.id, prefix]
  );
  res.json({ ok: true });
});

// 拉取项目会话元数据（侧栏任务行创建人 + 气泡发送人 + 排序模式）
router.get('/session-meta/:projectId', auth, async (req, res) => {
  const projectId = req.params.projectId;
  const role = await getProjectRole(req.user.id, projectId);
  if (!role) return res.status(403).json({ error: '无权访问该项目' });
  const [sortRes, ownersRes, sendersRes] = await Promise.all([
    db.query('SELECT session_sort FROM projects WHERE id = $1', [projectId]),
    db.query(
      `SELECT o.session_id, o.user_id, u.username
       FROM dsh_session_owners o JOIN users u ON u.id = o.user_id
       WHERE o.project_id = $1`,
      [projectId]
    ),
    db.query(
      `SELECT s.rpc_id, s.session_id, s.text_prefix, s.user_id, u.username
       FROM dsh_message_senders s JOIN users u ON u.id = s.user_id
       WHERE s.project_id = $1`,
      [projectId]
    ),
  ]);
  const owners = {};
  for (const r of ownersRes.rows) owners[r.session_id] = { id: r.user_id, username: r.username };
  // 前缀索引：气泡 DOM 按文本前缀对齐（同前缀冲突时取最新，罕见）
  const byPrefix = {};
  for (const r of sendersRes.rows) {
    if (!r.text_prefix) continue;
    byPrefix[`${r.session_id}\n${r.text_prefix}`] = { id: r.user_id, username: r.username };
  }
  const senders = {};
  for (const r of sendersRes.rows) senders[r.rpc_id] = { id: r.user_id, username: r.username };
  res.json({
    sort: sortRes.rows[0]?.session_sort || 'time',
    owners,
    senders,
    byPrefix,
  });
});

// 设置项目会话排序模式（time=时间倒序 / creator=按创建人 / manual=手动拖拽）
router.put('/session-sort/:projectId', auth, async (req, res) => {
  const projectId = req.params.projectId;
  const { mode } = req.body || {};
  if (!SORT_MODES.has(mode)) return res.status(400).json({ error: '无效排序模式' });
  const role = await getProjectRole(req.user.id, projectId);
  if (!role || role === 'shared') return res.status(403).json({ error: '无权访问该项目' });
  await db.query('UPDATE projects SET session_sort = $1, updated_at = NOW() WHERE id = $2', [mode, projectId]);
  res.json({ ok: true, mode });
});

// ★ host 沙箱 clamp 专用（2026-09-05）：全量 会话→创建人→有权限项目根。
// dsh host 插件（wb-src/src/host/sandbox-clamp.ts）拉取（SSE 变更推送 + 初始/重连
// 重同步，无轮询），用于把 danger-full-access 重定义为「可写创建人有权限的所有
// 项目」、把跨项目读收紧到有权限项目集合。认证走 x-madazi-internal（= JWT_SECRET，
// 仅集群内 dsh-web 容器持有）；未登记会话不在 map 内 → host 侧 fail-closed 仅本项目。
// 会话归属数据源 dsh_session_owners（cookie 鉴权上报 + ON CONFLICT DO NOTHING
// 先到先得，不可伪造他人归属）。
router.get('/session-access-map', async (req, res) => {
  if (!process.env.JWT_SECRET || req.get('x-madazi-internal') !== process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const ownersRes = await db.query(
    `SELECT so.session_id, COALESCE(so.active_user_id, so.user_id) AS user_id, u.role AS system_role
     FROM dsh_session_owners so JOIN users u ON u.id = COALESCE(so.active_user_id, so.user_id)`
  );
  // 权限计算按 user 去重（一个用户多个会话共享一次查询）
  const rootsByUser = new Map();
  const out = {};
  for (const r of ownersRes.rows) {
    if (!rootsByUser.has(r.user_id)) {
      const isAdmin = r.system_role === 'admin';
      const { rows } = await db.query(
        isAdmin
          ? `SELECT source_path FROM projects WHERE source_path IS NOT NULL`
          : `SELECT p.source_path FROM projects p
             LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
             WHERE (p.owner_id = $1 OR pm.user_id IS NOT NULL) AND p.source_path IS NOT NULL`,
        isAdmin ? [] : [r.user_id]
      );
      rootsByUser.set(r.user_id, rows.map((p) => p.source_path));
    }
    out[r.session_id] = { userId: r.user_id, roots: rootsByUser.get(r.user_id) };
  }
  res.json(out);
});

// ★ 权限映射变更推送（2026-09-05）：SSE 长连接。会话归属/项目成员/用户角色
// 变更 → bumpAccessMap() → 本端点推 changed → dsh-web sandbox-clamp 全量重拉。
// 替代轮询：撤销/授权秒级生效。连接建立即发初始信号（重同步双保险）。
// 25s 心跳防中间层（nginx/traefik）空闲断开；客户端断线指数退避重连。
router.get('/access-map/events', (req, res) => {
  if (!process.env.JWT_SECRET || req.get('x-madazi-internal') !== process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 防 nginx 缓冲 SSE 帧
  });
  res.flushHeaders();
  const send = () => res.write(`event: changed\ndata: ${Date.now()}\n\n`);
  send(); // 初始信号：连接建立即重同步
  const off = onAccessMapChanged(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    off();
  });
});

export default router;
