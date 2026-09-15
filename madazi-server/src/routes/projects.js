import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import { db } from '../db/init.js';
import { generateProject } from '../services/generator.js';
import { generateModularPlan } from '../services/initiate-via-chat.js';
import { collectProjectInfo } from '../services/generate-start-script.js';
import { getTemplatePath, getTemplateContext } from '../services/template.js';
import { chat as chatDirect, chatStream as chatStreamDirect, getDefaultConfig } from '../services/llm.js';
import { chat, chatStream } from '../services/llm-via-dsh.js'; // ★ P2：PRD/PLAN 等文档链路走 dsh pod，与 server 解耦
import { gitInit, gitCommit } from '../services/chat.js';
import { stopPreview } from '../services/preview.js';
import { cleanupProjectData } from '../services/preview-k8s.js';
import { ensureDshContainer, getDshPodAddr } from '../services/dsh-container-k8s.js';
import { DshBridge } from '../services/dsh-bridge.js';

import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { auth } from '../middleware/auth.js';
import { projectAccess, projectWriteAccess, getProjectRole } from '../middleware/permission.js';
import { publish } from '../services/bus.js'; // ★ 协同实时：新项目广播（管理员/成员即时刷新列表）
import { PROJECTS_ROOT, DSH_STORAGES } from '../config/paths.js';

// 项目源码根目录 = 平台唯一路径源（与 generator.js 一致）
const GENERATED_DIR = PROJECTS_ROOT;
fs.mkdirSync(GENERATED_DIR, { recursive: true });

const router = Router();

// 所有项目路由都需要登录
router.use(auth);

// 项目列表（自己的 + 被添加为成员的 + 共享的）
router.get('/', async (req, res) => {
  // ★ P2 B13：role 查库取最新值（JWT 内 role 是签发快照，降级后旧 token 仍有效）
  let isAdmin = false;
  if (req.user.username === 'madazi-service') {
    // ★ 服务身份（SERVICE_TOKEN 部署级信任凭证，users 表无 service 行）→ 直接视为 admin
    isAdmin = true;
  } else {
    try {
      const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
      isAdmin = rows[0]?.role === 'admin';
    } catch { /* 查失败按普通用户 */ }
  }
  let rows;
  if (isAdmin) {
    ({ rows } = await db.query("SELECT * FROM projects WHERE status != 'archived' ORDER BY COALESCE(last_opened_at, created_at) DESC"));
  } else {
    // 普通用户：自己创建的 + 作为成员的 + 共享的
    ({ rows } = await db.query(
      `SELECT p.* FROM projects p
       WHERE p.status != 'archived' AND (
         p.owner_id = $1
         OR p.is_shared = true
         OR p.id IN (SELECT project_id FROM project_members WHERE user_id = $1)
       )
       ORDER BY COALESCE(p.last_opened_at, p.created_at) DESC`,
      [req.user.id]
    ));
  }
  // ★ P2 B12：剔除 source_path（服务器绝对路径不外泄）
  for (const r of rows) delete r.source_path;
  return res.json(rows);
});

// ★ @ 跨项目文件搜索（2026-09-05）：@ 触发源的候选数据源（cookie 认证 + 成员权限过滤）。
// 三种 q 形态：
//   空        → 可见项目根列表（kind:'project'，客户端渲染为项目入口）
//   / 开头     → 绝对路径 drill（上一步选中目录后 query 变为路径前缀，列出其子项；
//               uuid 必须属于成员项目 + realpath 防穿越）
//   其他      → 全项目文件模糊匹配（内存索引缓存 30s）
// 返回 absPath 为 dsh 容器同路径（同 PVC 挂载 /app/generated/<pid>），mention 用绝对路径，
// agent 的 read 工具可直接读。exclude 参数排除当前项目（官方 @ 源已覆盖，避免重复列出）。
const FILE_SEARCH_EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', '.turbo', '.venv', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.gradle', '.next', 'target', 'coverage', '.cache',
]);
const _fileIndexCache = new Map(); // pid -> { at, entries: [{ p, k }] }

function _walkProjectFiles(root, maxEntries = 20000) {
  const entries = [];
  const queue = [{ dir: root, rel: '' }];
  while (queue.length > 0 && entries.length < maxEntries) {
    const { dir, rel } = queue.shift();
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of names) {
      if (entries.length >= maxEntries) break;
      if (FILE_SEARCH_EXCLUDE.has(d.name)) continue;
      const p = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) {
        entries.push({ p, k: 'directory' });
        queue.push({ dir: path.join(dir, d.name), rel: p });
      } else if (d.isFile()) {
        entries.push({ p, k: 'file' });
      }
    }
  }
  return entries;
}

function _projectFileIndex(pid, sourcePath) {
  const hit = _fileIndexCache.get(pid);
  if (hit && Date.now() - hit.at < 30000) return hit.entries;
  const entries = _walkProjectFiles(sourcePath);
  _fileIndexCache.set(pid, { at: Date.now(), entries });
  return entries;
}

router.get('/search-files', async (req, res) => {
  const q = String(req.query.q || '');
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 40);
  const exclude = String(req.query.exclude || '');

  // 可见项目（与 GET / 同语义：非归档 + owner/成员/共享；管理员全量）
  let isAdmin = false;
  try {
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    isAdmin = rows[0]?.role === 'admin';
  } catch { /* 查失败按普通用户 */ }
  let rows;
  if (isAdmin) {
    ({ rows } = await db.query("SELECT id, name, source_path FROM projects WHERE status != 'archived' ORDER BY COALESCE(last_opened_at, created_at) DESC"));
  } else {
    ({ rows } = await db.query(
      `SELECT p.id, p.name, p.source_path FROM projects p
       WHERE p.status != 'archived' AND (
         p.owner_id = $1
         OR p.id IN (SELECT project_id FROM project_members WHERE user_id = $1)
       )
       ORDER BY COALESCE(p.last_opened_at, p.created_at) DESC`,
      [req.user.id]
    ));
  }
  const projects = rows.filter((r) => r.source_path && fs.existsSync(r.source_path));

  // 形态一：空 query → 项目根
  if (q === '') {
    return res.json({
      items: projects.map((r) => ({
        projectId: r.id, projectName: r.name,
        absPath: r.source_path, relPath: '', kind: 'project',
      })),
    });
  }

  // 形态二：绝对路径 drill（<PROJECTS_ROOT>/<uuid>/…，prefix 来自部署环境）
  if (q.startsWith('/')) {
    const rootEsc = PROJECTS_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = q.match(new RegExp(`^${rootEsc}\\/([0-9a-fA-F-]{36})(\\/.*)?$`));
    const proj = m ? projects.find((r) => r.id === m[1]) : null;
    if (!proj) return res.json({ items: [] });
    const slash = q.lastIndexOf('/');
    const dirPart = slash < 0 ? q : q.slice(0, slash + 1); // 含尾斜杠的目录前缀
    const frag = slash < 0 ? '' : q.slice(slash + 1);    // 最后一段片段
    let dirRel = dirPart.replace(new RegExp(`^${rootEsc}\\/[0-9a-fA-F-]{36}\\/?`), '').replace(/\/+$/, '');
    if (dirRel.startsWith('..') || path.isAbsolute(dirRel)) return res.json({ items: [] });
    const full = path.resolve(path.join(proj.source_path, dirRel));
    // 防穿越（词法 + realpath 双校验，同 files/* 路由语义）
    const rel = path.relative(path.resolve(proj.source_path), full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return res.json({ items: [] });
    try {
      const realFull = fs.realpathSync(full);
      const realBase = fs.realpathSync(path.resolve(proj.source_path));
      const realRel = path.relative(realBase, realFull);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) return res.json({ items: [] });
    } catch { return res.json({ items: [] }); }
    let names;
    try { names = fs.readdirSync(full, { withFileTypes: true }); } catch { return res.json({ items: [] }); }
    const items = names
      .filter((d) => !FILE_SEARCH_EXCLUDE.has(d.name))
      .filter((d) => frag === '' || d.name.toLowerCase().includes(frag.toLowerCase()))
      .slice(0, limit)
      .map((d) => ({
        projectId: proj.id, projectName: proj.name,
        absPath: `${proj.source_path}/${dirRel ? dirRel + '/' : ''}${d.name}`,
        relPath: (dirRel ? dirRel + '/' : '') + d.name,
        kind: d.isDirectory() ? 'directory' : 'file',
      }));
    return res.json({ items });
  }

  // 形态三：跨项目模糊匹配
  const needle = q.toLowerCase();
  const items = [];
  for (const proj of projects) {
    if (proj.id === exclude) continue;
    if (items.length >= limit) break;
    const idx = _projectFileIndex(proj.id, proj.source_path);
    let got = 0;
    for (const e of idx) {
      if (got >= 6 || items.length >= limit) break;
      const pl = e.p.toLowerCase();
      const base = pl.slice(pl.lastIndexOf('/') + 1);
      if (base.includes(needle) || pl.includes(needle)) {
        items.push({
          projectId: proj.id, projectName: proj.name,
          absPath: `${proj.source_path}/${e.p}`, relPath: e.p, kind: e.k,
        });
        got++;
      }
    }
  }
  res.json({ items });
});

// 创建项目（注入 owner_id）
router.post('/', async (req, res) => {
  const { name, description, tech_stack, app_type, modules } = req.body;
  if (!name || !tech_stack || !app_type) {
    return res.status(400).json({ error: 'name, tech_stack, app_type 不能为空' });
  }
  const id = uuid();
  try {
    // 立即创建项目目录 + doc 子目录
    const projectDir = path.join(GENERATED_DIR, id);
    fs.mkdirSync(path.join(projectDir, 'doc'), { recursive: true });
    // 写一个 README 占位
    fs.writeFileSync(
      path.join(projectDir, 'doc', 'README.md'),
      `# ${name}\n\n项目文档目录。AI 生成的 PRD.md 和 doc/PLAN/ 开发计划会放在这里。\n`
    );

    // ★ 立即拷贝模板脚手架到项目目录
    const templatePath = getTemplatePath(tech_stack);
    if (fs.existsSync(templatePath)) {
      fs.cpSync(templatePath, projectDir, { recursive: true, filter: (src) => {
        const base = path.basename(src);
        return base !== 'template.json' && base !== 'README.md';
      }});
      console.log(`[create-project] Copied template ${tech_stack} -> ${projectDir}`);
    } else {
      console.warn(`[create-project] Template not found: ${tech_stack}, skipping copy`);
    }

    // ★ 创建即初始化 Git 仓库（含首个提交）：
    //   1) 工作台「源代码管理」面板开箱即用，无需用户手动 init
    //   2) chat-tasks 的 worktree 依赖 HEAD 存在——只 init 不 commit 会留 unborn HEAD，
    //      首个 AI 任务 git worktree add -b 直接失败（"无法创建工作目录"）
    try {
      gitInit(projectDir);
      gitCommit(projectDir, 'Initial state');
    } catch (e) {
      console.warn('[create-project] git init failed (non-critical):', e.message);
    }

    await db.query(
      'INSERT INTO projects (id, name, description, tech_stack, app_type, modules, owner_id, source_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, name, description, tech_stack, app_type, modules || null, req.user.id, projectDir]
    );
    // ★ 协同实时：新项目广播（bus → 全局 WS → 在线用户前端刷新列表，管理员即时看到他人新项目）
    try {
      publish({ t: 'project_created', projectId: id, name, ownerId: req.user.id, ownerName: req.user.username || '' });
    } catch (e) {
      console.warn('[projects] project_created publish failed:', e.message);
    }
    res.status(201).json({ id, name, description, tech_stack, app_type, modules, status: 'draft', owner_id: req.user.id, source_path: projectDir });
  } catch (err) {
    console.error('创建项目失败:', err);
    res.status(500).json({ error: '创建项目失败' });
  }
});

// Git 导入：克隆仓库作为项目（SSE 流式日志）
router.post('/import-git', async (req, res) => {
  const { name, gitUrl } = req.body;
  if (!name || !gitUrl) {
    return res.status(400).json({ error: 'name, gitUrl 不能为空' });
  }
  if (!/^https?:\/\/.+|^git@.+/.test(gitUrl)) {
    return res.status(400).json({ error: 'Git 地址格式不正确' });
  }

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.on('error', () => res.end()); // ★ P2 B5：客户端断连不抛 EPIPE
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendLog = (text) => res.write(`data: ${JSON.stringify({ type: 'log', text })}\n\n`);

  const id = uuid();
  try {
    const projectDir = path.join(GENERATED_DIR, id);
    fs.mkdirSync(projectDir, { recursive: true });

    // 异步 git clone，流式输出
    // ★ P0-2 修复：execFile 数组传参（shell:false），杜绝命令注入
    sendLog('正在克隆仓库...');
    const { execFile } = await import('child_process');
    await new Promise((resolve, reject) => {
      const proc = execFile('git', ['clone', '--depth', '1', gitUrl, projectDir], { timeout: 120000 }, (err) => {
        if (err) reject(new Error('git clone 失败'));
        else resolve();
      });
      proc.stderr?.on('data', (d) => {
        const t = d.toString().trim();
        if (t) sendLog(t);
      });
      proc.on('error', reject);
    });
    sendLog('✅ 仓库克隆完成');

    fs.mkdirSync(path.join(projectDir, 'doc'), { recursive: true });

    // 用 collectProjectInfo 检测技术栈
    const info = collectProjectInfo(projectDir);
    const d = info.detection;
    const parts = [d.frontend, d.backend].filter(Boolean);
    const techStack = parts.length ? parts.join(' + ') : 'unknown';
    sendLog(`技术栈：${techStack}${d.database ? ' + ' + d.database : ''}`);

    await db.query(
      'INSERT INTO projects (id, name, description, tech_stack, app_type, owner_id, source_path, source_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, name, `从 Git 导入：${gitUrl}`, techStack, 'web', req.user.id, projectDir, 'git']
    );

    // 写入项目根 AGENTS.md（dsh agent 每轮任务自动读取 → 运行时契约零成本常驻）
    // ★ 启动配置不在导入时生成：导入只留确定性步骤，.preview-config.json 由开场任务
    //   （kickoff）在对话里用用户自己的模型生成——模型协议适配归零、用户可全程干预
    try {
      const { writeProjectAgentsMd } = await import('../services/runtime-contract.js');
      const r = writeProjectAgentsMd(projectDir, { projectName: name, techStack, sourceDesc: `Git 导入：${gitUrl}` });
      if (r.written) sendLog('✅ AGENTS.md 已生成（AI 工作守则 + 运行时契约）');
    } catch { /* 不阻断导入 */ }

    sendLog('✅ 项目导入完成');
    res.write(`data: ${JSON.stringify({ type: 'done', project: { id, name, description: `从 Git 导入：${gitUrl}`, tech_stack: techStack, app_type: 'web', status: 'draft', owner_id: req.user.id, source_path: projectDir } })}\n\n`);
    res.end(); // ★ 必须收尾：消费端等流关闭才判定完成（曾缺此句 → 按钮永远卡「导入中」）
  } catch (err) {
    console.error('Git 导入失败:', err.message);
    sendLog(`❌ Git 导入失败: ${err.message || '克隆仓库出错'}`);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || '克隆仓库出错' })}\n\n`);
    res.end();
  }
});

// 本地 ZIP 导入（SSE 流式日志）
const upload = multer({ dest: path.join(GENERATED_DIR, '_uploads'), limits: { fileSize: 200 * 1024 * 1024, files: 20 } }); // ★ P2 B6：文件数上限 20（原 50×200MB=10GB/请求）
router.post('/import-zip', upload.single('zip'), async (req, res) => {
  const { name } = req.body;
  const file = req.file;
  if (!name || !file) {
    return res.status(400).json({ error: 'name 和 zip 文件不能为空' });
  }

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.on('error', () => res.end()); // ★ P2 B5：客户端断连不抛 EPIPE
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendLog = (text) => res.write(`data: ${JSON.stringify({ type: 'log', text })}\n\n`);

  const id = uuid();
  try {
    const projectDir = path.join(GENERATED_DIR, id);
    fs.mkdirSync(projectDir, { recursive: true });

    // 解压（★ P2-5 修复：原 unzipper.Extract 直接落盘，不校验路径，
    // 恶意 zip 可写 `../evil` 逃逸 projectDir 实现任意文件写入。改 Parse 逐条
    // 校验：拒绝路径穿越/绝对路径，限制条目数与解压总量防 zip bomb。）
    sendLog(`正在解压 ${file.originalname}（${(file.size / 1024 / 1024).toFixed(1)}MB）...`);
    const unzipper = (await import('unzipper')).default;
    await new Promise((resolve, reject) => {
      const MAX_ENTRIES = 5000;      // 防 zip bomb：条目数上限
      const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 解压总量上限 1GB
      let entryCount = 0;
      let totalBytes = 0;
      const stream = fs.createReadStream(file.path).pipe(unzipper.Parse());
      stream.on('entry', (entry) => {
        entryCount++;
        if (entryCount > MAX_ENTRIES) {
          entry.autodrain();
          return reject(new Error(`ZIP 条目数超过 ${MAX_ENTRIES} 上限，疑似 zip bomb`));
        }
        const raw = entry.path;
        const normalized = raw.replace(/\\/g, '/');
        // 路径穿越防护：拒绝 .. 段与绝对路径
        if (normalized.includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
          entry.autodrain();
          return reject(new Error(`ZIP 含非法路径: ${raw.slice(0, 80)}`));
        }
        if (entry.type === 'Directory') {
          entry.autodrain();
          return;
        }
        // 符号链接不跟随，直接丢弃（防链接逃逸）
        if (entry.type === 'SymbolicLink') {
          entry.autodrain();
          return;
        }
        const dest = path.join(projectDir, normalized);
        if (!dest.startsWith(projectDir + path.sep)) {
          entry.autodrain();
          return reject(new Error(`ZIP 路径逃逸被拦截: ${raw.slice(0, 80)}`));
        }
        // 防 zip bomb：声明大小预检 + 实际写入字节累计（声明可虚报——实际超限即中止）
        const declared = entry.vars.uncompressedSize || 0;
        totalBytes += declared;
        if (totalBytes > MAX_TOTAL_BYTES) {
          entry.autodrain();
          return reject(new Error(`ZIP 解压总量超过 1GB 上限，疑似 zip bomb`));
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const ws = fs.createWriteStream(dest);
        // ★ P2 B14：声明大小不可信（zip bomb 可虚报）——按实际解压字节累计，超限即中止整个流
        let entryActual = 0;
        entry.on('data', (chunk) => {
          entryActual += chunk.length;
          if (entryActual > MAX_TOTAL_BYTES) {
            entry.unpipe(ws);
            ws.destroy(new Error('ZIP 实际解压超过 1GB 上限，疑似 zip bomb'));
            entry.autodrain();
            stream.destroy(new Error('ZIP 实际解压超过 1GB 上限，疑似 zip bomb'));
          }
        });
        entry.pipe(ws);
      });
      stream.on('finish', resolve);
      stream.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
    });
    sendLog('✅ 解压完成');

    // 清理临时文件
    fs.unlinkSync(file.path);

    // 检查解压后是否有一层多余目录
    const entries = fs.readdirSync(projectDir);
    if (entries.length === 1 && fs.statSync(path.join(projectDir, entries[0])).isDirectory()) {
      const innerDir = path.join(projectDir, entries[0]);
      for (const item of fs.readdirSync(innerDir)) {
        fs.renameSync(path.join(innerDir, item), path.join(projectDir, item));
      }
      fs.rmdirSync(innerDir);
      sendLog('已展平目录结构');
    }

    fs.mkdirSync(path.join(projectDir, 'doc'), { recursive: true });

    // 用 collectProjectInfo 检测技术栈
    const info = collectProjectInfo(projectDir);
    const d = info.detection;
    const parts = [d.frontend, d.backend].filter(Boolean);
    const techStack = parts.length ? parts.join(' + ') : 'unknown';
    sendLog(`技术栈：${techStack}${d.database ? ' + ' + d.database : ''}`);

    await db.query(
      'INSERT INTO projects (id, name, description, tech_stack, app_type, owner_id, source_path, source_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, name, '从本地 ZIP 导入', techStack, 'web', req.user.id, projectDir, 'zip']
    );

    // 写入项目根 AGENTS.md（同 import-git：启动配置交给对话内开场任务生成）
    try {
      const { writeProjectAgentsMd } = await import('../services/runtime-contract.js');
      const r = writeProjectAgentsMd(projectDir, { projectName: name, techStack, sourceDesc: '本地 ZIP 导入' });
      if (r.written) sendLog('✅ AGENTS.md 已生成（AI 工作守则 + 运行时契约）');
    } catch { /* 不阻断导入 */ }

    sendLog('✅ 项目导入完成');
    res.write(`data: ${JSON.stringify({ type: 'done', project: { id, name, description: '从本地 ZIP 导入', tech_stack: techStack, app_type: 'web', status: 'draft', owner_id: req.user.id, source_path: projectDir } })}\n\n`);
    res.end(); // ★ 必须收尾：消费端等流关闭才判定完成
  } catch (err) {
    console.error('ZIP 导入失败:', err.message);
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    sendLog(`❌ ZIP 导入失败: ${err.message || '解压出错'}`);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || '解压出错' })}\n\n`);
    res.end();
  }
});

// 验证启动闭环（手动触发）：启动预览 → 服务级健康判定 → 失败抓日志派 AI 修复 → 重试 ≤3 轮
// SSE 事件与导入一致：log / done / error（前端复用 readImportSSE）
router.post('/:id/verify-start', projectAccess, async (req, res) => {
  const projectId = req.params.id;
  const { verifyStart, isVerifying } = await import('../services/verify-start.js');
  if (isVerifying(projectId)) {
    return res.status(409).json({ error: '验证启动已在进行中，请勿重复触发' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.on('error', () => res.end());
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  let aborted = false;
  res.on('close', () => { aborted = true; });
  const sendLog = (text) => { try { res.write(`data: ${JSON.stringify({ type: 'log', text })}\n\n`); } catch { /* 断连忽略 */ } };
  try {
    const result = await verifyStart({ projectId, userId: req.user.id, emit: sendLog, isAborted: () => aborted });
    res.write(`data: ${JSON.stringify({ type: 'done', ok: result.ok })}\n\n`);
  } catch (err) {
    console.error('验证启动失败:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || '验证启动异常' })}\n\n`);
  }
  res.end();
});
router.get('/:id', projectAccess, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  // 异步更新最近打开时间，不阻塞响应
  db.query('UPDATE projects SET last_opened_at = NOW() WHERE id = $1', [req.params.id]).catch(() => {});
  // ★ dsh 常驻容器/Pod 预启动（幂等；失败仅告警，不阻塞项目打开--任务时懒 ensure 兜底）
  ensureDshContainer(req.params.id).catch((err) => {
    console.warn(`[projects] dsh container ensure failed for ${req.params.id}: ${err.message}`);
  });
  // ★ P2 B12：剔除 source_path（服务器绝对路径不外泄）
  const { source_path, ...rest } = rows[0];
  res.json(rest);
});

// ★ B12 安全专用路径接口（2026-09-12 去硬编码化）：前端创建/打开工作区需要真实
//   absolute path，但 projectAccess 之外的 list/get 一律不泄 source_path。本接口挂
//   projectAccess（仅项目 owner/成员可查），返回该项目自己的工作区路径——不泄露
//   全局目录布局，语义与 B12 一致；source_path 缺失（老库）时按部署根推导。
router.get('/:id/workspace-path', projectAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const p = rows[0].source_path || path.join(PROJECTS_ROOT, req.params.id);
  res.json({ path: p });
});

// 修改项目（改名 / 描述 / 共享 / PRD / 计划 / LLM 配置）-- 仅所有者或管理员
router.put('/:id', projectWriteAccess, async (req, res) => {
  const { name, description, is_shared, prd_doc, plan_doc, llm_config_id, ai_mode } = req.body;
  // ★ P2 B4：敏感字段（共享开关/LLM 配置/PRD/计划/ai_mode）二次校验——普通成员可改名/描述，但不可动这些
  const SENSITIVE_KEYS = ['is_shared', 'prd_doc', 'plan_doc', 'llm_config_id', 'ai_mode'];
  if (SENSITIVE_KEYS.some((k) => req.body[k] !== undefined)) {
    const role = await getProjectRole(req.user.id, req.params.id);
    if (!['owner', 'admin', 'system_admin'].includes(role)) {
      return res.status(403).json({ error: '仅项目所有者/管理员可修改共享设置、LLM 配置等敏感项' });
    }
  }
  if (ai_mode !== undefined && ai_mode !== 'dsh') {
    return res.status(400).json({ error: 'ai_mode must be dsh' });
  }
  const { rows } = await db.query(
    `UPDATE projects SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       is_shared = COALESCE($3, is_shared),
       prd_doc = COALESCE($4, prd_doc),
       plan_doc = COALESCE($5, plan_doc),
       llm_config_id = COALESCE($6, llm_config_id),
       ai_mode = COALESCE($7, ai_mode),
       updated_at = NOW()
     WHERE id = $8 RETURNING *`,
    [name ?? null, description ?? null, is_shared ?? null, prd_doc ?? null, plan_doc ?? null, llm_config_id ?? null, ai_mode ?? null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// 触发 AI 生成（需权限）
router.post('/:id/generate', projectWriteAccess, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  const project = rows[0];
  await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['generating', project.id]);

  try {
    // 用 SSE 流式返回生成进度
    res.setHeader('Content-Type', 'text/event-stream');
  res.on('error', () => res.end()); // ★ P2 B5：客户端断连不抛 EPIPE
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const result = await generateProject(project, (chunk) => {
      res.write('data: ' + JSON.stringify({ type: 'chunk', content: chunk }) + '\n\n');
    });

    res.write('data: ' + JSON.stringify({ type: 'done', ...result }) + '\n\n');
    res.end();
  } catch (err) {
    await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['failed', project.id]);
    res.write('data: ' + JSON.stringify({ type: 'error', message: err.message }) + '\n\n');
    res.end();
  }
});

// ============ 全自动初始化（一条龙 SSE）============
// 描述 -> [可选提问] -> PRD -> 计划 -> 代码 -> 构建 -> 运行
// skip_questions=true 时 AI 自动推断答案，用户完全免干预
router.post('/:id/initiate', projectWriteAccess, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const project = rows[0];
  // 导入项目不支持一键生成（无对应模板），只走预览链路
  if (project.source_type && project.source_type !== 'template') {
    res.setHeader('Content-Type', 'text/event-stream');
  res.on('error', () => res.end()); // ★ P2 B5：客户端断连不抛 EPIPE
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('data: ' + JSON.stringify({ type: 'error', error: '导入项目不支持一键生成，请直接启动预览' }) + '\n\n');
    return res.end();
  }
  const { skip_questions = false, questions: existingQuestions = [], answers: existingAnswers = [] } = req.body;

  await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['generating', project.id]);

  // SSE 流式返回每一步进度
  res.setHeader('Content-Type', 'text/event-stream');
  res.on('error', () => res.end()); // ★ P2 B5：客户端断连不抛 EPIPE
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (type, data) => res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');

  try {
    // ===== Step 1: 头脑风暴提问（可跳过）=====
    let questions = existingQuestions;
    let answers = existingAnswers;
    if (!skip_questions && existingQuestions.length === 0) {
      send('step', { step: 'brainstorm', message: '正在思考关键问题...' });
      const msg = [
        { role: 'system', content: `你是一位资深产品经理。根据用户的项目描述，提出 3-5 个关键问题，帮用户理清需求。
问题要覆盖：用户群、核心功能、页面流程、数据模型、特殊约束。
每行一个问题，直接输出问题列表，不要编号不要前缀。` },
        { role: 'user', content: `项目名称：${project.name}\n技术栈：${project.tech_stack}\n功能模块：${project.modules || '未指定'}\n需求描述：${project.description}\n\n请提出问题。` }
      ];
      const resp = await chatDirect(msg, { temperature: 0.5, max_tokens: 800, userId: req.user.id, projectId: req.params.id });
      questions = resp.split('\n').map(s => s.trim()).filter(s => s && !s.match(/^[#*\d\-]/)).slice(0, 5);
      send('questions', { questions });
    }

    // ===== Step 1b: 如果跳过提问，AI 自动推断答案 =====
    if (skip_questions || answers.length < questions.length) {
      send('step', { step: 'infer_answers', message: '正在根据描述自动推断需求...' });
      const inferMsg = [
        { role: 'system', content: `你是产品经理。基于项目描述，为每个问题给出最合理的默认答案。
答案要具体、可执行。每行格式：问题 -> 答案` },
        { role: 'user', content: `项目：${project.name}\n技术栈：${project.tech_stack}\n描述：${project.description}\n模块：${project.modules || '未指定'}\n\n问题：\n${questions.join('\n')}` }
      ];
      const resp = await chatDirect(inferMsg, { temperature: 0.4, max_tokens: 1200, userId: req.user.id, projectId: req.params.id });
      // 解析「问题 -> 答案」格式，失败则整段作为一个答案
      const lines = resp.split('\n').filter(l => l.includes('->'));
      if (lines.length === questions.length) {
        answers = lines.map(l => l.split('->').slice(1).join('->').trim());
      } else {
        answers = questions.map(() => resp);
      }
      send('answers', { answers });
    }

    // ===== Step 2: 生成 PRD =====
    send('step', { step: 'prd', message: '正在撰写 PRD 文档...' });
    const qaText = questions.map((q, i) => `Q: ${q}\nA: ${answers[i] || '(未回答)'}`).join('\n\n');
    // ★ 注入模板上下文
    const tplCtx2 = getTemplateContext(project.tech_stack);
    const tplCtxText2 = tplCtx2
      ? `\n\n## 模板已有文件树\n${JSON.stringify(tplCtx2.tree, null, 2)}\n\n## 模板关键文件内容\n${Object.entries(tplCtx2.files).map(([k, v]) => `### ${k}\n\`\`\`\n${v}\n\`\`\``).join('\n')}`
      : '';
    const prd = await chatDirect([
      { role: 'system', content: `你是产品经理 + 技术架构师。基于项目描述和问答，生成完整 PRD。
用 Markdown 格式，包含：1.项目概述 2.用户角色 3.功能清单(带优先级P0/P1/P2) 4.页面清单 5.数据模型 6.接口清单 7.非功能需求

重要：项目脚手架模板已存在（技术栈 ${project.tech_stack}），含可运行基础结构和 CRUD 范例。以下是模板实际内容：
${tplCtxText2}

PRD 中标注「模板已有」或「需新建」。直接输出 Markdown，不要多余解释。` },
      { role: 'user', content: `项目名称：${project.name}\n技术栈：${project.tech_stack}\n功能模块：${project.modules || '未指定'}\n需求描述：${project.description}\n\n问答：\n${qaText}\n\n请生成 PRD。` }
    ], { temperature: 0.3, max_tokens: 16000, userId: req.user.id, projectId: req.params.id });
    await db.query('UPDATE projects SET prd_doc = $1 WHERE id = $2', [prd, project.id]);
    // ★ 同步写 doc/PRD.md（execute-plan / brainstorm/plan 优先读文件）
    try {
      const sp = project.source_path || path.join(GENERATED_DIR, project.id);
      fs.mkdirSync(path.join(sp, 'doc'), { recursive: true });
      fs.writeFileSync(path.join(sp, 'doc', 'PRD.md'), prd);
    } catch (e) { console.error('[initiate] write PRD.md error:', e.message); }
    send('prd', { prd });

    // ===== Step 3: 生成开发计划（模块化：doc/PLAN/ 多文件 + index.md）=====
    send('step', { step: 'plan', message: '正在制定开发计划...' });
    const planResult = await generateModularPlan({
      project,
      prd,
      emit: (chunk) => send('chunk', { content: chunk }),
    });
    send('plan', { plan: planResult.plan });

    // ===== Step 4: 生成代码 + 构建 =====
    send('step', { step: 'generate', message: '正在生成代码...' });
    const refreshedProject = { ...project, prd_doc: prd, plan_doc: planResult.plan };
    const result = await generateProject(refreshedProject, (chunk) => {
      send('chunk', { content: chunk });
    });
    send('done', result);
    res.end();
  } catch (err) {
    console.error('[initiate] error:', err);
    await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['failed', project.id]);
    send('error', { message: err.message });
    res.end();
  }
});

// 项目文件树（需权限）
router.get('/:id/files', projectAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.json([]);

  const tree = buildFileTree(rows[0].source_path);
  res.json(tree);
});

// 读取文件内容（需权限）
router.get('/:id/files/*', projectAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(404).json({ error: 'Not generated yet' });

  const filePath = path.join(rows[0].source_path, req.params[0]);
  const fullPath = path.resolve(filePath);

  // 防止目录穿越（★ P1-4 修复：startsWith 前缀可被 proj-1-evil 绕过，改用 path.relative）
  const base = path.resolve(rows[0].source_path);
  const rel = path.relative(base, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    // rel === '' 表示正好等于项目根目录，目录本身允许读取文件列表，但这里是读文件，根目录不是文件
    if (rel === '' && fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      // 允许（目录本身，sendFile 会处理）
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  // ★ P0-A4 修复：symlink 逃逸防护——词法校验可被项目内符号链接绕过，realpath 后必须仍在项目内
  try {
    const realFull = fs.realpathSync(fullPath);
    const realBase = fs.realpathSync(base);
    const realRel = path.relative(realBase, realFull);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) return res.status(403).json({ error: 'Forbidden' });
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  res.sendFile(fullPath);
});

// ============ 文件编辑 API（编辑器用）============

// 安全检查：确保路径在项目目录内
// ★ P1-4 修复：startsWith 前缀可被 /proj-1-evil 绕过，改用 path.relative
function safePath(sourcePath, relPath) {
  const full = path.resolve(path.join(sourcePath, relPath));
  const base = path.resolve(sourcePath);
  const rel = path.relative(base, full);
  // ★ P0-A4 修复：realpath 二次校验——项目内 symlink 可把词法路径带出项目（如 .git/hooks 写入 RCE）
  try {
    const probe = fs.existsSync(full) ? full : path.dirname(full);
    const realFull = fs.realpathSync(probe);
    const realBase = fs.realpathSync(base);
    const realRel = path.relative(realBase, realFull);
    if (realRel === '') return full;
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) return null;
  } catch {
    return null;
  }
  if (rel === '') return full; // 项目根目录，允许
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

// 保存文件（PUT /:id/files/*）
router.put('/:id/files/*', projectWriteAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(400).json({ error: '项目未生成' });

  const fullPath = safePath(rows[0].source_path, req.params[0]);
  if (!fullPath) return res.status(403).json({ error: '路径非法' });

  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content 必填' });

  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    res.json({ ok: true, path: req.params[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新建文件或文件夹（POST /:id/files）
// body: { path: 'relative/path', type: 'file'|'dir', content?: string }
router.post('/:id/files', projectWriteAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(400).json({ error: '项目未生成' });

  const { path: relPath, type, content } = req.body;
  if (!relPath) return res.status(400).json({ error: 'path 必填' });

  const fullPath = safePath(rows[0].source_path, relPath);
  if (!fullPath) return res.status(403).json({ error: '路径非法' });

  if (fs.existsSync(fullPath)) return res.status(409).json({ error: '已存在' });

  try {
    if (type === 'dir') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content || '');
    }
    res.json({ ok: true, path: relPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除文件或文件夹（DELETE /:id/files/*）
router.delete('/:id/files/*', projectWriteAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(400).json({ error: '项目未生成' });

  const fullPath = safePath(rows[0].source_path, req.params[0]);
  if (!fullPath) return res.status(403).json({ error: '路径非法' });

  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '不存在' });

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动/重命名（POST /:id/files/move）
// body: { from: 'old/path', to: 'new/path' }
router.post('/:id/files/move', projectWriteAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(400).json({ error: '项目未生成' });

  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from 和 to 必填' });

  const fromPath = safePath(rows[0].source_path, from);
  const toPath = safePath(rows[0].source_path, to);
  if (!fromPath || !toPath) return res.status(403).json({ error: '路径非法' });

  if (!fs.existsSync(fromPath)) return res.status(404).json({ error: '源文件不存在' });
  if (fs.existsSync(toPath)) return res.status(409).json({ error: '目标已存在' });

  try {
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.renameSync(fromPath, toPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传文件（POST /:id/files/upload，multipart: files[] + dir + paths[]）
// paths[] 可选：文件夹上传时携带 webkitRelativePath 保留目录结构
router.post('/:id/files/upload', projectWriteAccess, upload.array('files', 20), async (req, res) => { // ★ P2 B6：20 个上限
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(400).json({ error: '项目未生成' });

  const dir = (req.body.dir || '').replace(/^\/+|\/+$/g, '');
  const paths = Array.isArray(req.body.paths) ? req.body.paths : [];
  const files = req.files || [];
  if (!files || files.length === 0) return res.status(400).json({ error: '未收到文件' });
  // ★ P2 B6：请求总大小上限（20×200MB 仍达 4GB——收紧为 500MB）
  const MAX_TOTAL_UPLOAD = 500 * 1024 * 1024;
  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
  if (totalSize > MAX_TOTAL_UPLOAD) {
    for (const f of files) { if (f.path) try { fs.unlinkSync(f.path); } catch {} }
    return res.status(413).json({ error: `上传总大小超过 500MB 上限` });
  }

  const results = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // 优先用前端传的相对路径（保留文件夹结构），去掉首层目录名后拼到目标 dir
      let rel = String(paths[i] || f.originalname || 'file');
      // 防路径穿越：只留相对部分
      rel = rel.replace(/^\/+/, '').split(/[/\\]/).filter(p => p && p !== '.' && p !== '..').join('/');
      const targetRel = dir ? `${dir}/${rel}` : rel;
      const fullPath = safePath(rows[0].source_path, targetRel);
      if (!fullPath) {
        f.path && require('fs').unlinkSync(f.path); // 清理临时文件
        return res.status(403).json({ error: `路径非法: ${targetRel}` });
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.renameSync(f.path, fullPath); // 覆盖同名
      results.push({ name: f.originalname, path: targetRel, size: f.size });
    }
    res.json({ ok: true, count: results.length, files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 下载单个文件或目录 zip（GET /:id/files-download/*）
// 目录自动打包 zip；文件直接流式返回
router.get('/:id/files-download/*', projectAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(404).json({ error: 'Not generated yet' });

  const fullPath = safePath(rows[0].source_path, req.params[0]);
  if (!fullPath) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  const baseName = path.basename(fullPath);
  const stat = fs.statSync(fullPath);

  if (stat.isDirectory()) {
    // 目录 -> zip 流式下载
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); else res.end(); });
    archive.pipe(res);
    archive.directory(fullPath, baseName); // zip 内含顶层目录
    archive.finalize();
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}`);
    res.sendFile(fullPath);
  }
});

// 下载项目 zip（需权限）
router.get('/:id/download', projectAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path, name FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.status(404).json({ error: 'Not generated yet' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${rows[0].name}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  archive.directory(rows[0].source_path, false);
  archive.finalize();
});

// ★ 删除操作锁：per-project，防止并发删除/与预览 stop·restart 互踩（与 preview.js 同模式，锁独立）
const _delLocks = new Map(); // projectId -> { op, user, at }
const DEL_LOCK_TTL = 120000;

// 删除项目（仅管理员；dsh-web 侧栏「删除项目」接此处）
router.delete('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT source_path, owner_id FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  // 权限检查：仅管理员（role 查库取最新值，JWT 内是签发快照）
  let isAdmin = req.user.role === 'admin';
  if (isAdmin) {
    try {
      const { rows: u } = await db.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
      isAdmin = u[0]?.role === 'admin';
    } catch { /* 查失败按已有判定 */ }
  }
  if (!isAdmin) {
    return res.status(403).json({ error: '只有管理员可以删除项目' });
  }

  const projectId = req.params.id;
  const sourcePath = rows[0]?.source_path;
  const projectDirName = sourcePath ? path.basename(sourcePath) : null;

  // 0. 操作锁：删除期间拒绝并发删除（预览 stop/restart 锁在 preview.js，各自独立）
  const now = Date.now();
  const held = _delLocks.get(projectId);
  if (held && (now - held.at) < DEL_LOCK_TTL) {
    return res.status(409).json({ error: `项目正在执行${held.op === 'delete' ? '删除' : '其他操作'}，请稍后再试` });
  }
  _delLocks.set(projectId, { op: 'delete', user: req.user?.username || 'unknown', at: now });
  try {
    // 1. 停止预览（关闭终端会话 + 删预览 Pod + 清理内存 Map）
    try { await stopPreview(projectId); } catch (e) {
      console.warn('[delete-project] stopPreview failed:', e.message);
    }

    // 1.5 等预览 Pod 完全终止（PVC 挂载释放，否则 cleanup Pod 的 rm -rf 会漏删）
    try {
      const { waitPreviewPodGone } = await import('../services/preview-k8s.js');
      await waitPreviewPodGone(projectId, 60_000);
    } catch (e) {
      console.warn('[delete-project] waitPreviewPodGone failed:', e.message);
    }

    // 2. 清理 dsh 容器 Pod（此前未调用 removeForProject，删除项目后 dsh 沙箱 Pod 残留）
    try {
      const { removeForProject } = await import('../services/dsh-container-k8s.js');
      await removeForProject(projectId);
      console.log(`[delete-project] Removed dsh container pod: ${projectId}`);
    } catch (e) {
      console.warn('[delete-project] removeForProject failed:', e.message);
    }

    // 3. 清理项目生成数据目录（K8s: PVC /data/<projectDirName>，cleanup Pod rm -rf）
    if (projectDirName) {
      const cleaned = await cleanupProjectData(projectId, projectDirName);
      if (cleaned) {
        console.log(`[delete-project] Cleaned project data: /data/${projectDirName}{,-wt-*, .dsh/sessions/--app-generated-${projectDirName}*, .dsh-sessions/--app-generated-${projectDirName}*}`);
      } else {
        // 清理失败仍继续删记录（源码目录已不存在、会话已无家可归，保留记录只会造成幽灵项目）；
        // 孤儿 PVC 目录打日志待人工回收
        console.warn(`[delete-project] Failed to clean /data/${projectDirName}（PVC 可能残留孤儿目录，请人工检查）`);
      }
    }

    // 3.5 ★ 清理 dsh-web 工作区注册表（workspace.json + session_projcache.json）
    //   dsh-web 独立维护这两个文件（不经过平台 DB），删除项目时必须同步清理，
    //   否则侧栏列表残留已删项目（path 指向不存在的目录）。
    //   storages 落点 = 平台唯一路径源（k8s=/app/generated/.dsh/storages；单机版=DSH_HOME/storages）。
    try {
      const storagesDir = DSH_STORAGES;
      const wsFile = path.join(storagesDir, 'workspace.json');
      const scFile = path.join(storagesDir, 'session_projcache.json');
      const projPath = path.join(PROJECTS_ROOT, projectDirName);
      // workspace.json: 删 workspaces 表中 path 匹配的条目 + global.workspaceIds
      if (fs.existsSync(wsFile)) {
        const ws = JSON.parse(fs.readFileSync(wsFile, 'utf-8'));
        let changed = false;
        if (ws.tables?.workspaces) {
          for (const [wid, w] of Object.entries(ws.tables.workspaces)) {
            if (w.path === projPath) {
              delete ws.tables.workspaces[wid];
              changed = true;
              console.log(`[delete-project] Removed dsh workspace ${wid} (path=${projPath})`);
            }
          }
        }
        if (changed && Array.isArray(ws.global?.workspaceIds)) {
          const liveIds = new Set(Object.keys(ws.tables.workspaces));
          ws.global.workspaceIds = ws.global.workspaceIds.filter(id => liveIds.has(id));
        }
        if (changed) fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2));
      }
      // session_projcache.json: 删 sessions 表中 cwd 匹配的条目
      if (fs.existsSync(scFile)) {
        const sc = JSON.parse(fs.readFileSync(scFile, 'utf-8'));
        let changed = false;
        if (sc.tables?.sessions) {
          for (const [sid, s] of Object.entries(sc.tables.sessions)) {
            if (s.identity?.cwd === projPath) {
              delete sc.tables.sessions[sid];
              changed = true;
            }
          }
        }
        if (changed) {
          fs.writeFileSync(scFile, JSON.stringify(sc, null, 2));
          console.log(`[delete-project] Cleaned session_projcache for ${projectDirName}`);
        }
      }
    } catch (e) {
      console.warn('[delete-project] dsh storages cleanup failed (non-critical):', e.message);
    }

    // 4. ★ 归档：保留源码目录（只清理运行时资源），不删 PVC 目录
    // 5. ★ 归档：保留 DB 记录，设 status=archived（不 DELETE，不触发 CASCADE 清 conversations）
    //    conversations/conversation_messages 通过项目列表过滤自然隐藏
    await db.query("UPDATE projects SET status = 'archived', updated_at = NOW() WHERE id = $1", [projectId]);
    console.log(`[delete-project] Archived DB record: ${projectId} (source preserved at ${sourcePath})`);
    res.json({ ok: true, archived: true });
  } finally {
    _delLocks.delete(projectId);
  }
});

// ============ 自定义技能（.dsh/skills/*.md，官方 dsh-skill-filesystem 扫描目录）============

// 解析 markdown frontmatter + body
function parseSkillFile(filePath, fileName) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) return null;

    const frontmatter = fmMatch[1];
    const body = fmMatch[2].trim();
    const meta = {};
    for (const line of frontmatter.split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }

    const id = fileName.replace(/\.md$/, '');
    return {
      id: `custom-${id}`,
      name: meta.name || id,
      description: meta.description || '',
      icon: meta.icon || 'sparkles',
      color: meta.color || '#5E6AD2',
      bgColor: meta.bgColor || `rgba(94, 106, 210, 0.12)`,
      prompt: body,
      custom: true,
    };
  } catch {
    return null;
  }
}

// 获取项目自定义技能
router.get('/:id/skills', projectAccess, async (req, res) => {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
  if (!rows[0]?.source_path) return res.json([]);

  const skillsDir = path.join(rows[0].source_path, '.agents', 'skills');
  if (!fs.existsSync(skillsDir)) return res.json([]);

  try {
    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
    const skills = files
      .map(f => parseSkillFile(path.join(skillsDir, f), f))
      .filter(Boolean);
    res.json(skills);
  } catch {
    res.json([]);
  }
});

// ============ 头脑风暴（文档驱动生成流程）============

// ★ P2：用户拒绝过头脑风暴（跳过/关闭提问）——DB 记录（多人跨平台同步），此后不再自动触发提问
router.post('/:id/brainstorm/skip', projectWriteAccess, async (req, res) => {
  try {
    await db.query('UPDATE projects SET brainstorm_skipped = TRUE WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step 1: AI 根据项目描述 + 项目文件生成提问（★ P2：走 dsh pod，与 server 解耦）
router.post('/:id/brainstorm', projectWriteAccess, async (req, res) => {
  const { name, description, tech_stack, modules } = req.body;
  try {
    // ★ P2：风暴问题完全走 dsh pod（LLM 调用全在 pod 层，server 只做调度）
    // 失败直接 500（前端有错误提示+手动重试），不再 fallback server 直调
    const row = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
    const projectDir = row.rows[0]?.source_path;
    if (!projectDir) throw new Error('project has no source_path');
    const resp = await brainstormViaDsh(req.params.id, projectDir, { name, description, tech_stack, modules });
    // 解析 JSON（兼容 LLM 可能加 markdown 包裹、前缀文字、尾逗号等）
    const { summary, questions } = parseBrainstormJson(resp);
    res.json({ summary, questions: questions.slice(0, 5) });
  } catch (e) {
    console.error('[brainstorm] questions error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Step 2: 根据用户答案生成 PRD.md
router.post('/:id/brainstorm/answer', projectWriteAccess, async (req, res) => {
  const { questions, answers, project } = req.body;

  try {
    const qaText = questions.map((q, i) => `Q: ${q}\nA: ${answers[i] || '(未回答)'}`).join('\n\n');
    const tplCtx = getTemplateContext(project.tech_stack);
    const tplCtxText = tplCtx
      ? `\n\n## 模板已有文件树\n${JSON.stringify(tplCtx.tree, null, 2)}\n\n## 模板关键文件内容\n${Object.entries(tplCtx.files).map(([k, v]) => `### ${k}\n\`\`\`\n${v}\n\`\`\``).join('\n')}`
      : '';
    // SSE 流式输出 PRD 生成过程
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // ★ P2-8 修复：客户端断开时 res 触发 error，原代码未监听会抛 unhandled error 崩进程
    res.on('error', () => res.end());

    // ===== Step 1: 动态提取章节清单 =====
    const sections = await extractPrdSections({ project, qaText });

    // 发章节清单标记（前端据此渲染完整任务列表 + "待生成"占位）
    const sectionList = sections.map((s, i) => ({ seq: String(i + 1).padStart(2, '0'), name: s.name }));
    res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: `<<<PRD_SECTION_TOTAL|${JSON.stringify(sectionList)}>>>\n` })}\n\n`);

    // ===== Step 2: 逐章生成 =====
    let prd = '';
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const seq = String(i + 1).padStart(2, '0');

      // 章节开始标记（含章节名，前端渲染任务卡片标题）
      res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: `<<<PRD_SECTION_START|${seq}|${sec.name}>>>\n` })}\n\n`);
      // 完整文档写入章节标题
      prd += `## ${seq}. ${sec.name}\n\n`;

      // 每章独立 thinking 分路器，避免跨章节状态残留
      const splitter = makeThinkingSplitter();
      await chatStream(
        [
          {
            role: 'system',
            content: `你是产品经理 + 技术架构师。撰写 PRD 的「${sec.name}」章节。Markdown 格式，直接输出该章节正文（不要一级标题、不要输出其他章节内容）。
重要：项目脚手架模板已存在（技术栈 ${project.tech_stack}），包含可运行的基础结构和 CRUD 范例。
以下是模板的实际内容和文件树，AI 后续将基于这些已有代码工作：
${tplCtxText}

PRD 中的文件清单应标注「模板已有」或「需新建」。不需要从零生成脚手架。

直接输出 Markdown，不要多余解释。`
          },
          {
            role: 'user',
            content: `项目名称：${project.name}\n技术栈：${project.tech_stack}\n功能模块：${project.modules || '未指定'}\n需求描述：${project.description}\n\n问答：\n${qaText}\n\n请撰写 PRD 的「${sec.name}」章节。`
          }
        ],
        (chunk) => {
          const { content, thinking } = splitter(chunk);
          if (thinking) {
            // 思考过程单独发事件，前端 ThinkingBlock 折叠展示，不进文档
            res.write(`event: thinking\ndata: ${JSON.stringify({ thinking })}\n\n`);
          }
          if (content) {
            prd += content;
            res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: content })}\n\n`);
          }
        },
        { temperature: 0.3, max_tokens: 6000, continueOnTruncation: true, userId: req.user.id, projectId: req.params.id },
      );

      prd += '\n\n';
      // 章节结束标记
      res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: '<<<PRD_SECTION_END>>>\n' })}\n\n`);
    }

    if (!prd.trim()) {
      throw new Error('AI 返回内容为空，请检查模型配置或重试');
    }

    // 保存到数据库
    await db.query('UPDATE projects SET prd_doc = $1 WHERE id = $2', [prd, req.params.id]);
    try {
      const { rows: pRows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
      const sp = pRows[0]?.source_path;
      if (sp) {
        fs.mkdirSync(path.join(sp, 'doc'), { recursive: true });
        fs.writeFileSync(path.join(sp, 'doc', 'PRD.md'), prd);
      }
    } catch (e) { console.error('[brainstorm] write PRD.md error:', e.message); }

    res.write(`event: done\ndata: ${JSON.stringify({ prd })}\n\n`);
    res.end();
  } catch (e) {
    console.error('[brainstorm] prd error:', e);
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// 动态提取 PRD 章节清单（LLM 主路径 + 固定 7 章兜底）
async function extractPrdSections({ project, qaText }) {
  try {
    const resp = await chat(
      [
        {
          role: 'system',
          content: `你是产品经理。根据项目描述和问答，列出 PRD（项目需求文档）应该包含的章节清单。返回纯 JSON 数组，不要 markdown 代码块，不要解释。
格式：[{"name":"章节名"}]
章节应覆盖：项目概述、用户角色、功能清单（带优先级 P0/P1/P2）、页面清单、数据模型、接口清单、非功能需求等，可根据项目规模合并或拆分，控制在 5-10 章。章节名用中文。`,
        },
        {
          role: 'user',
          content: `项目名称：${project.name}\n技术栈：${project.tech_stack}\n功能模块：${project.modules || '未指定'}\n需求描述：${project.description}\n\n问答：\n${qaText}\n\n请列出 PRD 章节清单。`,
        },
      ],
      { temperature: 0.2, max_tokens: 1000, projectId: project.id }, // ★ P2：走 dsh pod
    );
    const clean = resp.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('空章节');
    const sections = parsed
      .map((s) => ({ name: String(s?.name || '').trim() }))
      .filter((s) => s.name);
    if (sections.length === 0) throw new Error('空章节');
    return sections;
  } catch (e) {
    console.warn('[extractPrdSections] parse failed, fallback to 7 sections:', e.message);
    return [
      { name: '项目概述' },
      { name: '用户角色' },
      { name: '功能清单' },
      { name: '页面清单' },
      { name: '数据模型' },
      { name: '接口清单' },
      { name: '非功能需求' },
    ];
  }
}

// Step 3: 根据 PRD 生成开发计划（模块化：doc/PLAN/ 多文件 + index.md）
router.post('/:id/brainstorm/plan', projectWriteAccess, async (req, res) => {
  let { prd } = req.body;

  try {
    // 从 DB 读取完整 project（含 source_path），前端传来的 project 可能缺字段
    const { rows: pRows } = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!pRows[0]) throw new Error('项目不存在');
    const project = pRows[0];

    // ★ 优先读磁盘 doc/PRD.md（AI 调整 PRD 是直接编辑文件，前端 prdDoc state 可能滞后）
    const prdFilePath = path.join(project.source_path || '', 'doc', 'PRD.md');
    if (fs.existsSync(prdFilePath)) {
      const filePrd = fs.readFileSync(prdFilePath, 'utf8').trim();
      if (filePrd) prd = filePrd;
    }
    if (!prd) throw new Error('缺少 PRD 内容');

    // SSE 流式输出 PLAN 生成过程
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // ★ P2-8 修复：客户端断开时 res 触发 error，原代码未监听会抛 unhandled error 崩进程
    res.on('error', () => res.end());

    let plan = '';
    const splitter = makeThinkingSplitter();
    // ★ 标记单独走 SSE chunk（与 initiate 聊天路径一致），不混入 plan 文档文本
    await generateModularPlan({
      project,
      prd,
      onModulesTotal: (mods) => {
        res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: `<<<PLAN_MOD_TOTAL|${JSON.stringify(mods)}>>>\n` })}\n\n`);
      },
      onModuleStart: ({ seq, name }) => {
        res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: `<<<PLAN_MOD_START|${seq}|${name}>>>\n` })}\n\n`);
      },
      onModuleDone: () => {
        res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: '<<<PLAN_MOD_END>>>\n' })}\n\n`);
      },
      emit: (text) => {
        const { content, thinking } = splitter(text);
        if (thinking) {
          // 思考过程单独发事件，前端 ThinkingBlock 折叠展示，不进文档
          res.write(`event: thinking\ndata: ${JSON.stringify({ thinking })}\n\n`);
        }
        if (content) {
          plan += content;
          res.write(`event: chunk\ndata: ${JSON.stringify({ chunk: content })}\n\n`);
        }
      },
    });

    if (!plan.trim()) {
      throw new Error('AI 返回内容为空，请检查模型配置或重试');
    }

    res.write(`event: done\ndata: ${JSON.stringify({ plan })}\n\n`);
    res.end();
  } catch (e) {
    console.error('[brainstorm] plan error:', e);
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

function buildFileTree(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  const items = fs.readdirSync(dir);
  return items
    .filter(name => name !== 'node_modules' && name !== '.git' && name !== 'dist')
    .map(name => {
      const fullPath = path.join(dir, name);
      const relPath = base ? base + '/' + name : name;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return { name, path: relPath, type: 'dir', children: buildFileTree(fullPath, relPath) };
      }
      return { name, path: relPath, type: 'file', size: stat.size };
    });
}

// 流式拆分 LLM 思考标签 <thinking>...</thinking>（DeepSeek 等模型的 reasoning 输出）
// chatStream 会把 reasoning 内容用 <thinking> 包裹发给 onChunk（对话面板展示用）。
// PRD/PLAN 接口需要两类数据：thinking（前端 ThinkingBlock 折叠展示，不进文档）+ content（正文，进文档）。
// 返回增量分路器：输入 chunk，输出 { content, thinking } 增量
function makeThinkingSplitter() {
  let buf = '';
  let inThinking = false;
  const TAG_OPEN = '<thinking>';
  const TAG_CLOSE = '</thinking>';
  return (chunk) => {
    buf += chunk;
    let content = '';
    let thinking = '';
    for (;;) {
      if (inThinking) {
        const i = buf.indexOf(TAG_CLOSE);
        if (i === -1) {
          // 未闭合：保留尾部可能是闭合标签前缀的部分，其余归入 thinking
          const keepLen = Math.min(buf.length, TAG_CLOSE.length - 1);
          const tail = buf.slice(-keepLen);
          if (tail && TAG_CLOSE.startsWith(tail)) {
            thinking += buf.slice(0, buf.length - keepLen);
            buf = tail;
          } else {
            thinking += buf;
            buf = '';
          }
          break;
        }
        thinking += buf.slice(0, i);
        buf = buf.slice(i + TAG_CLOSE.length);
        // 吞掉 thinking 块后的换行（llm.js 在 </thinking> 后发 '\n'）
        if (buf.startsWith('\r\n')) buf = buf.slice(2);
        else if (buf.startsWith('\n')) buf = buf.slice(1);
        inThinking = false;
      } else {
        const i = buf.indexOf(TAG_OPEN);
        if (i === -1) {
          // 未开启：输出全部，但保留尾部可能是开启标签前缀的部分
          const keepLen = Math.min(buf.length, TAG_OPEN.length - 1);
          const tail = buf.slice(-keepLen);
          if (tail && TAG_OPEN.startsWith(tail)) {
            content += buf.slice(0, buf.length - keepLen);
            buf = tail;
          } else {
            content += buf;
            buf = '';
          }
          break;
        }
        content += buf.slice(0, i);
        buf = buf.slice(i + TAG_OPEN.length);
        inThinking = true;
      }
    }
    return { content, thinking };
  };
}

// ★ P2：收集项目文件上下文（目录树 + 关键文件摘要），供 dsh 版风暴问题参考（模板项目文件不多，直接读入 prompt）
function buildBrainstormContext(projectDir) {
  try {
    if (!fs.existsSync(projectDir)) return '(项目目录为空)';
    const lines = ['【项目文件结构】'];
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.git') continue;
      lines.push(`${e.isDirectory() ? '[dir] ' : ''}${e.name}`);
    }
    const KEY_FILES = ['README.md', 'package.json', 'frontend/package.json', 'backend/package.json', 'app.json', 'project.config.json', 'manifest.json', 'requirements.txt', 'go.mod', 'pom.xml', 'src/main/resources/application.yml'];
    for (const rel of KEY_FILES) {
      const fp = path.join(projectDir, rel);
      if (!fs.existsSync(fp)) continue;
      try {
        const content = fs.readFileSync(fp, 'utf8').slice(0, 1500);
        lines.push(`\n【文件 ${rel}】\n${content}`);
      } catch { /* 跳过不可读文件 */ }
    }
    return lines.join('\n');
  } catch (e) {
    return '(读取项目文件失败)';
  }
}

// ★ P2：风暴问题走 dsh pod 执行（agent 上下文 = 项目文件，与 execute-plan 同链路）；失败由调用方 fallback server 直调
async function brainstormViaDsh(projectId, projectDir, { name, description, tech_stack, modules }) {
  const cfg = await getDefaultConfig();
  if (!cfg) throw new Error('No LLM config. Please configure API key in Settings.');
  await ensureDshContainer(projectId);
  const addr = await getDshPodAddr(projectId, 60_000);
  const bridge = new DshBridge({
    tcp: addr,
    cwd: projectDir,
    env: {
      DEEPSEEK_API_KEY: cfg.api_key,
      DEEPSEEK_BASE_URL: cfg.base_url,
      DEEPSEEK_MODEL: cfg.model,
      DSH_PROJECT_ID: projectId,
      DSH_TASK_ID: `brainstorm-${Date.now()}`,
      DSH_WORKTREE: projectDir,
      DSH_PERMISSION_MODE: 'read-only', // 风暴问题只读，禁止写
      DSH_SNAPSHOT_SESSIONS_ROOT: '/tmp/dsh-sessions',
      DSH_CWD: projectDir,
    },
    spawnTimeoutMs: 60_000,
    requestTimeoutMs: 150_000, // 风暴问题上限 150s（正常秒级返回）
  });
  try {
    await bridge.start();
    const sessionId = await bridge.newSession();
    const systemPrompt = `你是一位资深产品经理。根据用户的项目描述和项目文件，提出 3-5 个关键问题，帮用户理清需求。

原则：
- 先判断项目描述中哪些维度已经清楚，清楚的不要问，只问模糊或缺失的维度。
- 维度参考（不要求全部覆盖，按需选择）：目标用户、核心场景、权限角色、关键数据实体、页面流程、交互偏好、特殊约束（合规/性能/兼容性）。
- 问题要具体到当前项目，不要泛泛而问"你的用户是谁"，要问"这个库存管理系统是给仓库管理员单独用，还是采购也能操作？"
- 每个问题必须附带 2-4 个建议选项，选项要具体且贴合当前项目，不要放"其他"这种无信息量选项。
- 项目文件结构/内容已附在下方，直接参考即可；不要调用任何工具，不要读更多文件——直接输出 JSON。

输出严格的 JSON 对象格式（不要 markdown 包裹，不要多余文字）：
{
  "summary": "用一句话概括你对项目的理解，例如：一个面向仓库管理员的库存管理系统，支持扫码入库、库存预警和盘点。",
  "questions": [
    {
      "question": "这个库存管理系统是给仓库管理员单独用，还是采购也能操作？",
      "options": ["仅仓库管理员", "仓库+采购共用", "全员可用"],
      "allowInput": true
    }
  ]
}

allowInput 始终为 true（用户总能补充）。summary 必须有。`;
    const userPrompt = `项目名称：${name}
技术栈：${tech_stack}
功能模块：${modules || '未指定'}
需求描述：${description}

${buildBrainstormContext(projectDir)}

请提出问题。`;
    const { text } = await bridge.prompt(sessionId, `${systemPrompt}\n\n${userPrompt}`, {});
    return text || '';
  } finally {
    if (bridge.connected) await bridge.stop().catch(() => {});
  }
}

// 健壮解析脑暴 JSON：兼容 markdown 包裹、前缀/后缀文字、尾逗号、纯数组旧格式
function parseBrainstormJson(resp) {
  let cleaned = (resp || '').trim();
  // 1) 提取 ```json ... ``` 代码块（可能前面有文字）
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  // 2) 提取 JSON 主体：数组用 [ ]，对象用 { }（容忍前后缀文字）
  const trimStart = cleaned.charAt(0) === '[' ? '[' : '{';
  const trimEnd = trimStart === '[' ? ']' : '}';
  const firstBrace = cleaned.indexOf(trimStart);
  const lastBrace = cleaned.lastIndexOf(trimEnd);
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  const tryParse = (s) => {
    try { return { ok: true, val: JSON.parse(s) }; } catch { return { ok: false }; }
  };
  // 3) 依次尝试：原样 → 清尾逗号（,} 或 ,] 前的逗号）→ 宽松 JSON
  let parsed = null;
  const attempts = [cleaned, cleaned.replace(/,\s*([}\]])/g, '$1')];
  for (const attempt of attempts) {
    const r = tryParse(attempt);
    if (r.ok) { parsed = r.val; break; }
  }
  let summary = '';
  let questions = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.questions)) {
    // 新格式：{ summary, questions }
    summary = parsed.summary || '';
    questions = parsed.questions;
  } else if (Array.isArray(parsed)) {
    // 兼容旧格式：纯数组
    questions = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions)) {
    summary = parsed.summary || '';
    questions = parsed.questions;
  }
  // 4) 终极兜底：按行切，但过滤掉 JSON 语法行（{ } " [ ] , 等开头）
  if (questions.length === 0) {
    questions = cleaned.split('\n')
      .map(s => s.trim())
      .filter(s => s && !/^[{}\[\]",]/.test(s) && !/^[#*\d\-]/.test(s) && (s.includes('？') || s.length > 8))
      .slice(0, 5)
      .map(q => ({ question: q, options: [], allowInput: true }));
  }
  // 规范化 question 对象（容忍缺字段）
  questions = questions
    .filter(q => q && typeof q === 'object' && (q.question || q.text || q.q))
    .map(q => ({
      question: q.question || q.text || q.q || '',
      options: Array.isArray(q.options) ? q.options : [],
      allowInput: q.allowInput !== false,
    }));
  return { summary, questions };
}

export default router;
