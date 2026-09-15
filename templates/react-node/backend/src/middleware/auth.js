import { query } from '../db.js';

// 加载用户完整信息（角色码 + 权限码集合）
// super_admin 直接放行全部权限（permissions = ['*']）
export async function loadUserAuth(userId) {
  const u = await query(
    `SELECT id, username, nickname, email, phone, status FROM user_account WHERE id = $1`,
    [userId]
  );
  if (u.rows.length === 0) return null;
  const user = u.rows[0];
  if (user.status !== '1') return null;

  const roles = await query(
    `SELECT r.id, r.code, r.name FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = $1`,
    [userId]
  );
  user.roles = roles.rows;
  const roleCodes = roles.rows.map((r) => r.code);

  if (roleCodes.includes('super_admin')) {
    user.permissions = ['*'];
  } else {
    const perms = await query(
      `SELECT DISTINCT m.code FROM user_role ur
       JOIN role_menu rm ON rm.role_id = ur.role_id
       JOIN menu m ON m.id = rm.menu_id
       WHERE ur.user_id = $1`,
      [userId]
    );
    user.permissions = perms.rows.map((p) => p.code);
  }
  return user;
}

// Bearer Token 鉴权中间件：校验会话 -> 挂 req.user
export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ code: 401, message: '未登录' });

  const sess = await query(`SELECT user_id, expires_at FROM user_session WHERE token = $1`, [token]);
  if (sess.rows.length === 0) return res.status(401).json({ code: 401, message: '会话不存在或已过期' });
  if (new Date(sess.rows[0].expires_at) < new Date()) {
    await query(`DELETE FROM user_session WHERE token = $1`, [token]);
    return res.status(401).json({ code: 401, message: '会话已过期' });
  }

  const user = await loadUserAuth(sess.rows[0].user_id);
  if (!user) return res.status(401).json({ code: 401, message: '用户不可用' });

  req.user = user;
  req.token = token;
  next();
}

// 权限码校验中间件工厂
export function requirePerm(code) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    if (perms.includes('*') || perms.includes(code)) return next();
    return res.status(403).json({ code: 403, message: '无权限执行该操作' });
  };
}
