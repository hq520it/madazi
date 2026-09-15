import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { db } from '../db/init.js';
import { auth, signToken } from '../middleware/auth.js';

const router = Router();
const NODE_ENV = process.env.NODE_ENV;

// ★ P2-9 修复：登录/注册内存限流（单 IP 10 分钟内最多 5 次，防暴力破解/注册轰炸）
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const rateHits = new Map(); // ip -> number[]
function rateLimit(ip) {
  const now = Date.now();
  const arr = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) return false;
  arr.push(now);
  rateHits.set(ip, arr);
  return true;
}
function rateLimitMiddleware(req, res, next) {
  // ★ P2 B10：nginx 已覆盖 XFF（只传真实 IP）；这里再加 User-Agent 组合键，
  // 即便直连 NodePort 绕过 nginx（无 XFF）也按 req.ip+UA 限流，且伪造 XFF 无收益
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  const key = ip + '|' + (req.headers['user-agent'] || '');
  if (!rateLimit(key)) {
    return res.status(429).json({ error: '尝试过于频繁，请 10 分钟后再试' });
  }
  next();
}


// 注册：需邀请码
router.post('/register', rateLimitMiddleware, async (req, res) => {
  const { code, username, password } = req.body;

  if (!code || !username || !password) {
    return res.status(400).json({ error: '邀请码、用户名、密码不能为空' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }

  // 检查邀请码
  const { rows: codeRows } = await db.query(
    'SELECT * FROM invite_codes WHERE code = $1 AND used_by IS NULL',
    [code]
  );
  if (codeRows.length === 0) {
    return res.status(400).json({ error: '邀请码无效或已被使用' });
  }

  // 检查用户名是否已存在
  const { rows: userRows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (userRows.length > 0) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  // 创建用户
  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 10);
  await db.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [id, username, passwordHash, 'user']
  );

  // 标记邀请码已使用
  await db.query(
    'UPDATE invite_codes SET used_by = $1, used_at = NOW() WHERE code = $2',
    [id, code]
  );

  // 发 token
  const token = signToken({ id, username, role: 'user' });
  res.status(201).json({ token, user: { id, username, role: 'user' } });
});

// 登录
router.post('/login', rateLimitMiddleware, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  if (rows.length === 0) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  // 种 HttpOnly cookie（S2-1：dsh-web 登录门；浏览器自动携带，auth 中间件 cookie 回退已支持）
  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.cookie('madazi_token', token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 与 JWT_EXPIRES 24h 对齐
    path: '/',
  });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// 登出：清 cookie（S2-1）
router.post('/logout', (req, res) => {
  res.clearCookie('madazi_token', { path: '/' });
  res.json({ ok: true });
});

// 获取当前用户信息
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
