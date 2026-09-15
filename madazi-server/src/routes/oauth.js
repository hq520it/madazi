// 三方登录路由（2026-08-28）
// GET /:provider/start     → 302 到三方授权页（state 防 CSRF，5min TTL）
// GET /:provider/callback  → 换 token → 查/建号 → 种 madazi_token cookie → 302 前端
// 自动建号：首次扫码即建平台账号（password_hash 为随机串，无法密码登录；source='oauth'）。
// 公开端点（不挂 auth 中间件）；受 licenseGate 全局门禁约束（index.js）。

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/init.js';
import { signToken } from '../middleware/auth.js';
import { buildAuthUrl, loadConfig, oauthExchange, OAUTH_PROVIDERS } from '../services/oauth/index.js';

const router = Router();

// ---- state 防 CSRF（内存 Map，5min TTL；单副本部署够用，多副本需 Redis，见 P1a 外移模式）----
const states = new Map(); // `${provider}:${state}` -> { at }
const STATE_TTL = 5 * 60 * 1000;

function issueState(provider) {
  const state = crypto.randomBytes(16).toString('hex');
  states.set(`${provider}:${state}`, { at: Date.now() });
  return state;
}

function verifyState(provider, state) {
  const key = `${provider}:${state}`;
  const rec = states.get(key);
  if (!rec) return false;
  states.delete(key); // 一次性
  return Date.now() - rec.at <= STATE_TTL;
}

// 回调地址动态构造（兼容多域名/多协议部署；三方后台配的就是这个）
function redirectUri(req, provider) {
  return `${req.protocol}://${req.get('host')}/api/auth/oauth/${provider}/callback`;
}

// 查/建号：命中绑定直接返回；否则自动建号（username = <provider>_<id前12位>，冲突加后缀）
async function findOrCreateUser(provider, profile) {
  const { rows: bound } = await db.query(
    'SELECT user_id FROM user_oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
    [provider, profile.id]
  );
  if (bound[0]) {
    // 更新头像（昵称不动——username 是登录名，不随三方改名，避免混乱）
    if (profile.avatar) {
      await db.query('UPDATE users SET avatar = $1 WHERE id = $2', [profile.avatar, bound[0].user_id]);
    }
    await db.query('UPDATE user_oauth_accounts SET last_login_at = NOW(), profile = $1 WHERE provider = $2 AND provider_user_id = $3',
      [JSON.stringify(profile.raw || {}), provider, profile.id]);
    return bound[0].user_id;
  }

  let username = `${provider}_${String(profile.id || '').slice(0, 12)}`;
  const base = username;
  let n = 1;
  // 用户名冲突（含同名注册用户）→ 追加序号
  for (;;) {
    const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (!rows.length) break;
    username = `${base}_${n++}`;
  }
  // 无密码用户：随机 hash 永远无法密码登录（password_hash NOT NULL 约束兼容）
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const userId = uuid();
  await db.query(
    'INSERT INTO users (id, username, password_hash, role, avatar, source) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, username, passwordHash, 'user', profile.avatar || null, 'oauth']
  );
  await db.query(
    'INSERT INTO user_oauth_accounts (id, user_id, provider, provider_user_id, union_id, profile) VALUES ($1, $2, $3, $4, $5, $6)',
    [uuid(), userId, provider, profile.id, profile.unionId || null, JSON.stringify(profile.raw || {})]
  );
  return userId;
}

// 已启用 provider 列表（公开，登录页渲染扫码入口用；不泄露任何 secret）
router.get('/providers', async (req, res) => {
  const providers = [];
  for (const name of OAUTH_PROVIDERS) {
    const cfg = await loadConfig(name);
    if (cfg && cfg.enabled && cfg.appId && cfg.secret) providers.push(name);
  }
  res.json({ providers });
});

// 前端登录页按钮直接 href 到 /api/auth/oauth/:provider/start → 302 三方授权页（全链路原生跳转）
router.get('/:provider/start', async (req, res) => {
  const { provider } = req.params;
  if (!OAUTH_PROVIDERS.includes(provider)) {
    return res.status(404).json({ error: '未知登录方式' });
  }
  try {
    const state = issueState(provider);
    const url = await buildAuthUrl(provider, state, redirectUri(req, provider));
    res.redirect(url);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 三方回调
router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;
  if (!OAUTH_PROVIDERS.includes(provider)) {
    return res.status(400).send('未知登录方式');
  }
  if (!code) return res.status(400).send('缺少授权 code');
  if (!state || !verifyState(provider, state)) {
    return res.status(400).send('state 校验失败，请重新发起登录');
  }
  try {
    const { profile } = await oauthExchange(provider, code, redirectUri(req, provider));
    if (!profile.id) throw new Error('未拿到三方用户 ID');
    const userId = await findOrCreateUser(provider, profile);
    const { rows } = await db.query('SELECT id, username, role FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    const token = signToken({ id: user.id, username: user.username, role: user.role });
    res.cookie('madazi_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.redirect('/?oauth=success');
  } catch (err) {
    console.error(`[oauth:${provider}] callback 失败:`, err.message);
    res.redirect(`/?oauth=error&msg=${encodeURIComponent(err.message || '登录失败')}`);
  }
});

export default router;
