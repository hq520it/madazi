import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { db } from '../db/init.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { getAllSettings, setSettings, getSettingNumber } from '../services/settings.js';
import { encryptKey } from '../services/keycrypto.js';
import { OAUTH_PROVIDERS, loadConfig } from '../services/oauth/index.js';
import { getUsageSummary, getUsageLogs, getQuotaList, setUserQuota } from '../services/usage.js';
import { PROJECTS_ROOT } from '../config/paths.js';
import { bumpAccessMap } from '../services/access-map-events.js';
import { getAllPreviews, stopPreview } from '../services/preview.js';

const router = Router();

// 所有管理员路由都需要登录 + 管理员权限
router.use(auth, adminOnly);

// ============ 用户管理 ============

// 用户列表
router.get('/users', async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(rows);
});

// 创建用户
router.post('/users', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  if (role && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: '角色只能是 admin 或 user' });
  }

  const { rows: existing } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.length > 0) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 10);
  await db.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [id, username, passwordHash, role || 'user']
  );
  res.status(201).json({ id, username, role: role || 'user' });
});

// 删除用户
router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: '不能删除自己' });
  }
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (rowCount === 0) {
    return res.status(404).json({ error: '用户不存在' });
  }
  bumpAccessMap(); // 用户删除 → 会话映射消失 → 推送映射更新
  res.json({ ok: true });
});

// 修改用户角色
router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: '角色只能是 admin 或 user' });
  }
  const { rowCount } = await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  if (rowCount === 0) {
    return res.status(404).json({ error: '用户不存在' });
  }
  bumpAccessMap(); // 角色变更 → 权限根集合变化 → 推送映射更新
  res.json({ ok: true });
});

// 重置用户密码（管理员）
router.put('/users/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  const { rowCount } = await db.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
  if (rowCount === 0) {
    return res.status(404).json({ error: '用户不存在' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.params.id]);
  res.json({ ok: true });
});

// ============ 邀请码管理 ============

// 生成邀请码
router.post('/invites', async (req, res) => {
  const code = uuid().replace(/-/g, '').slice(0, 16).toUpperCase();
  await db.query(
    'INSERT INTO invite_codes (code, created_by) VALUES ($1, $2)',
    [code, req.user.id]
  );
  res.status(201).json({ code, created_by: req.user.id });
});

// 邀请码列表
router.get('/invites', async (req, res) => {
  const { rows } = await db.query(
    `SELECT i.code, i.created_at, i.used_at,
       cu.username as created_by_name,
       uu.username as used_by_name
     FROM invite_codes i
     LEFT JOIN users cu ON i.created_by = cu.id
     LEFT JOIN users uu ON i.used_by = uu.id
     ORDER BY i.created_at DESC`
  );
  res.json(rows);
});

// 删除邀请码
router.delete('/invites/:code', async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM invite_codes WHERE code = $1 AND used_by IS NULL', [req.params.code]);
  if (rowCount === 0) {
    return res.status(404).json({ error: '邀请码不存在或已被使用' });
  }
  res.json({ ok: true });
});

// ============ 容器管理设置 ============

// 获取所有设置
router.get('/settings', async (req, res) => {
  const settings = await getAllSettings();
  res.json(settings);
});

// 更新设置
router.put('/settings', async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings 对象必填' });
  }
  // 白名单校验，只允许已知的配置项
  const ALLOWED = ['preview_idle_timeout', 'preview_max_per_user', 'preview_cpu_limit', 'preview_memory_limit', 'preview_global_max', 'task_max_concurrent'];
  const ALLOWED_STR = ['merge_conflict_mode']; // 字符串配置项（枚举值）
  const filtered = {};
  for (const key of ALLOWED) {
    if (key in settings) {
      const v = parseInt(settings[key], 10);
      if (isNaN(v) || v < 0) {
        return res.status(400).json({ error: `${key} 必须是非负整数` });
      }
      filtered[key] = String(v);
    }
  }
  for (const key of ALLOWED_STR) {
    if (key in settings) {
      if (!['manual', 'auto-llm'].includes(settings[key])) {
        return res.status(400).json({ error: `${key} 必须是 manual 或 auto-llm` });
      }
      filtered[key] = settings[key];
    }
  }
  const updated = await setSettings(filtered);
  res.json({ ok: true, settings: updated });
});

// ============ 预览容器管理 ============

// 所有运行中的预览
router.get('/previews', (req, res) => {
  const all = getAllPreviews().map(p => ({
    projectId: p.projectId,
    projectName: p.projectName,
    userId: p.userId,
    startedAt: p.startedAt,
    lastAccessedAt: p.lastAccessedAt,
    status: p.status,
    containerName: p.containerName,
  }));
  res.json(all);
});

// 强制停止某个预览
router.post('/previews/:id/stop', async (req, res) => {
  await stopPreview(req.params.id);
  res.json({ ok: true });
});

// ★ 列出所有预览容器（含 exited 的，管理员查看用）
router.get('/preview-containers', async (req, res) => {
  try {
    const { listPreviewPods } = await import('../services/preview-k8s.js');
    const pods = await listPreviewPods();
    res.json(pods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ★ 删除指定预览容器（真正释放磁盘；K8s: 删 Pod）
router.delete('/preview-containers/:name', async (req, res) => {
  try {
    const name = req.params.name;
    if (!name.startsWith('madazi-preview-')) {
      return res.status(400).json({ error: '无效的容器名' });
    }
    const { deletePreviewPodByName } = await import('../services/preview-k8s.js');
    const result = await deletePreviewPodByName(name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ★ 批量清理所有 exited 容器（K8s: 回收非 Running 的孤儿 preview Pod）
router.post('/preview-containers/cleanup-exited', async (req, res) => {
  try {
    const { reapOrphanPreviewPods } = await import('../services/preview-k8s.js');
    await reapOrphanPreviewPods(new Set(), new Map(), 0);
    res.json({ ok: true, cleaned: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== 用量计量与配额（P0-2） ======

// 用量汇总（趋势/按用户/按模型/按项目）
router.get('/usage/summary', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
    const summary = await getUsageSummary({
      days,
      userId: req.query.userId || undefined,
      projectId: req.query.projectId || undefined,
    });
    res.json(summary);
  } catch (err) {
    console.error('用量汇总失败:', err);
    res.status(500).json({ error: '用量汇总失败' });
  }
});

// 用量明细分页
router.get('/usage/logs', async (req, res) => {
  try {
    const result = await getUsageLogs({
      page: parseInt(req.query.page) || 1,
      pageSize: Math.min(Math.max(parseInt(req.query.pageSize) || 20, 1), 100),
      userId: req.query.userId || undefined,
      model: req.query.model || undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('用量明细失败:', err);
    res.status(500).json({ error: '用量明细失败' });
  }
});

// 配额列表（所有用户 + 今日用量）
router.get('/quotas', async (req, res) => {
  try {
    res.json({ rows: await getQuotaList(), globalLimit: await getSettingNumber('daily_tokens_limit', 0) });
  } catch (err) {
    console.error('配额列表失败:', err);
    res.status(500).json({ error: '配额列表失败' });
  }
});

// 设置全局默认配额（0=不限）
router.put('/quotas/global', async (req, res) => {
  try {
    const limit = Math.max(0, Math.floor(Number(req.body.dailyTokensLimit) || 0));
    await setSettings({ daily_tokens_limit: String(limit) });
    res.json({ ok: true, dailyTokensLimit: limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 设置某用户配额（limit=0 不限；limit=null 跟随全局）
router.put('/quotas/user/:userId', async (req, res) => {
  try {
    const limit = req.body.dailyTokensLimit;
    await setUserQuota(req.params.userId, limit === null || limit === undefined ? null : Number(limit));
    res.json({ ok: true });
  } catch (err) {
    console.error('设置用户配额失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 模型价格列表（官方币种 + 每百万 tokens 价；无官方价的模型 = 未定价）
router.get('/model-prices', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT model, currency, input_price_per_m AS input, output_price_per_m AS output,
              updated_at, (SELECT value FROM settings WHERE key = 'usd_cny_rate') AS usd_cny_rate
       FROM model_costs ORDER BY model`
    );
    const rate = Number(rows[0]?.usd_cny_rate) || 7.2;
    const list = rows.map((r) => ({
      model: r.model, currency: r.currency, input: Number(r.input), output: Number(r.output),
      updatedAt: r.updated_at,
      usdInput: r.currency === 'CNY' ? Number(r.input) / rate : Number(r.input),
      usdOutput: r.currency === 'CNY' ? Number(r.output) / rate : Number(r.output),
    }));
    res.json({ rows: list, usdCnyRate: rate });
  } catch (err) {
    console.error('模型价格列表失败:', err);
    res.status(500).json({ error: '模型价格列表失败' });
  }
});

// 更新/添加模型价格（currency: USD|CNY；0 表示未定价）
router.put('/model-prices/:model', async (req, res) => {
  try {
    const { currency, input, output } = req.body;
    if (!['USD', 'CNY'].includes(currency)) return res.status(400).json({ error: 'currency 必须是 USD 或 CNY' });
    await db.query(
      `INSERT INTO model_costs (model, currency, input_price_per_m, output_price_per_m, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (model) DO UPDATE SET currency = $2, input_price_per_m = $3, output_price_per_m = $4, updated_at = NOW()`,
      [req.params.model, currency, Number(input) || 0, Number(output) || 0]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('更新模型价格失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ 残留分支清理 ============

function projectGitDir(projectId) {
  const dir = path.join(PROJECTS_ROOT, projectId);
  if (!fs.existsSync(path.join(dir, '.git'))) throw new Error('项目 Git 仓库不存在');
  return dir;
}

function runGit(projectId, args) {
  return execFileSync('git', args, {
    cwd: projectGitDir(projectId),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

// 列出残留分支（ai-task-*，含 worktree 占用标记）
router.get('/projects/:id/residual-branches', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name FROM projects WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '项目不存在' });
    const out = runGit(req.params.id, ['branch', '--list', 'ai-task-*']);
    const branches = out.split('\n').map(s => s.trim().replace(/^\* /, '')).filter(Boolean);
    res.json({ projectId: req.params.id, projectName: rows[0].name, count: branches.length, branches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清理残留分支（先删 ai-task worktree，再删分支）
router.post('/projects/:id/residual-branches/cleanup', async (req, res) => {
  try {
    const projectId = req.params.id;
    // 1. 删所有 ai-task worktree（目录名带 -wt-<短id> 后缀）
    const wtOut = runGit(projectId, ['worktree', 'list', '--porcelain']);
    const wtDirs = wtOut.split('\n')
      .filter(l => l.startsWith('worktree '))
      .map(l => l.slice('worktree '.length).trim())
      .filter(d => /-wt-[a-z0-9]+$/.test(d));
    const dir = projectGitDir(projectId);
    for (const wt of wtDirs) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: dir, encoding: 'utf8' });
      } catch (e) { console.error('worktree 删除失败:', wt, e.message); }
    }
    runGit(projectId, ['worktree', 'prune']);
    // 2. 删所有 ai-task 分支
    const branches = runGit(projectId, ['branch', '--list', 'ai-task-*'])
      .split('\n').map(s => s.trim().replace(/^\* /, '')).filter(Boolean);
    let deleted = 0;
    for (const b of branches) {
      try {
        execFileSync('git', ['branch', '-D', b], { cwd: dir, encoding: 'utf8' });
        deleted++;
      } catch (e) { console.error('分支删除失败:', b, e.message); }
    }
    res.json({ ok: true, deletedWorktrees: wtDirs.length, deletedBranches: deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 三方登录配置（OAuth） ============
// 存 settings 表 oauth_<name>（JSON；secret 经 keycrypto 加密）。GET 一律脱敏，绝不出 secret 明文。

// 获取三家配置（secret 只回 hasSecret 布尔）
router.get('/oauth', async (req, res) => {
  const out = {};
  for (const name of OAUTH_PROVIDERS) {
    const cfg = await loadConfig(name);
    out[name] = {
      enabled: !!(cfg && cfg.enabled),
      appId: (cfg && cfg.appId) || '',
      agentId: name === 'wecom' ? ((cfg && cfg.agentId) || '') : null,
      hasSecret: !!(cfg && cfg.secret),
    };
  }
  res.json(out);
});

// 保存三家配置：body = { wecom: {...}, feishu: {...}, dingtalk: {...} }
// secret 非空 → 加密覆盖；空/缺 → 保留旧值（避免前端拿不到明文后误清空）
router.put('/oauth', async (req, res) => {
  const body = req.body || {};
  const updated = {};
  for (const name of OAUTH_PROVIDERS) {
    const entry = body[name];
    if (!entry || typeof entry !== 'object') continue;
    const prev = await loadConfig(name);
    const next = prev && typeof prev === 'object' ? { ...prev } : {};
    if (typeof entry.enabled === 'boolean') next.enabled = entry.enabled;
    if (typeof entry.appId === 'string' && entry.appId.trim()) next.appId = entry.appId.trim();
    if (name === 'wecom' && typeof entry.agentId === 'string') next.agentId = entry.agentId.trim();
    if (typeof entry.secret === 'string' && entry.secret.trim()) {
      next.secret = encryptKey(entry.secret.trim());
    }
    updated[`oauth_${name}`] = JSON.stringify(next);
  }
  if (Object.keys(updated).length === 0) {
    return res.status(400).json({ error: '没有可更新的配置' });
  }
  await setSettings(updated);
  res.json({ ok: true });
});

export default router;
