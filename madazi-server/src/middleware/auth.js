import jwt from 'jsonwebtoken';
import { db } from '../db/init.js';

// 生产环境必须设置 JWT_SECRET 环境变量，开发环境用固定值方便本地调试
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('JWT_SECRET environment variable is required in production'); })()
  : 'madazi-dev-secret-change-in-prod');
const JWT_EXPIRES = '24h';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// JWT 认证中间件：校验 token，注入 req.user
// 支持 header (Authorization: Bearer *** 、query (?token=xxx，EventSource 旧方式)
// 和 cookie (madazi_token，EventSource 新方式——前端登录时已种 cookie，同源自动携带，避免 token 泄漏到 URL 日志)
export function auth(req, res, next) {
  const header = req.headers.authorization;
  let token = null;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
    // ★ 2026-09-13 服务身份（bridge 等内部调用者）：SERVICE_TOKEN 匹配即放行，
    //   不查登录态。单机 start.sh 注入 server；dsh 插件 node 半（MADAZI_SVC_TOKEN）
    //   与云版部署模板共用同一个值。未配置 SERVICE_TOKEN 时此分支不启用。
    if (process.env.SERVICE_TOKEN && token === process.env.SERVICE_TOKEN) {
      req.user = { id: 'service', username: 'madazi-service', role: 'admin' };
      return next();
    }
  } else if (req.query.token) {
    token = req.query.token;
  } else {
    // ★ P2: cookie fallback——EventSource 无法带自定义 header，query token 会泄漏到访问日志
    const cookieHeader = req.headers.cookie || '';
    const m = cookieHeader.match(/(?:^|;\s*)madazi_token=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'token 无效或已过期' });
  }
  req.user = payload; // { id, username, role }
  next();
}

// 可选认证：有 token 就注入 req.user，没有也放行
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  let token = null;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.query.token) {
    token = req.query.token;
  }
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}

// 管理员权限中间件
export async function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录' });
  }
  // ★ 服务身份跳过查库（users 表无 service 行；SERVICE_TOKEN 已是部署级信任凭证）
  if (req.user.username === 'madazi-service') {
    return next();
  }
  // ★ P2 B13：JWT 内 role 是签发时快照（24h 有效）——降级后旧 token 仍按旧角色放行。
  // 每次请求查库取最新 role（users 主键索引查询，开销可忽略）。
  try {
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (rows[0]?.role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
  } catch (err) {
    console.error('[auth] adminOnly role refresh failed:', err.message);
    return res.status(500).json({ error: '权限校验失败' });
  }
  next();
}

export { JWT_SECRET };
