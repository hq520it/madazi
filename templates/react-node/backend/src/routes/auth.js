import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { query, verifyPassword } from '../db.js';
import { authMiddleware, loadUserAuth } from '../middleware/auth.js';
import { buildTree } from '../utils/tree.js';

const router = Router();
const SESSION_DAYS = 7;

// 用户可见菜单树（type='menu'，按角色过滤；super_admin 全量）
async function loadMenus(userId, roleCodes) {
  let rows;
  if (roleCodes.includes('super_admin')) {
    rows = await query(`SELECT * FROM menu WHERE type = 'menu' AND status = '1'`);
  } else {
    rows = await query(
      `SELECT DISTINCT m.* FROM user_role ur
       JOIN role_menu rm ON rm.role_id = ur.role_id
       JOIN menu m ON m.id = rm.menu_id
       WHERE ur.user_id = $1 AND m.type = 'menu' AND m.status = '1'`,
      [userId]
    );
  }
  return buildTree(rows.rows);
}

// 登录（公开接口）
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '用户名和密码必填' });
    }
    const u = await query(
      `SELECT id, username, nickname, email, phone, status, password_hash, password_salt FROM user_account WHERE username = $1`,
      [username]
    );
    if (u.rows.length === 0 || !verifyPassword(password, u.rows[0].password_salt, u.rows[0].password_hash)) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误' });
    }
    if (u.rows[0].status !== '1') {
      return res.status(403).json({ code: 403, message: '账号已停用' });
    }

    // 创建会话
    const token = randomBytes(32).toString('hex');
    await query(
      `INSERT INTO user_session (token, user_id, expires_at) VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`,
      [token, u.rows[0].id, String(SESSION_DAYS)]
    );

    const user = await loadUserAuth(u.rows[0].id);
    const menus = await loadMenus(user.id, user.roles.map((r) => r.code));
    res.json({
      code: 200,
      data: { token, user, menus },
      message: 'success',
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 当前用户信息（含权限码 + 菜单树）
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await loadUserAuth(req.user.id);
    const menus = await loadMenus(user.id, user.roles.map((r) => r.code));
    res.json({ code: 200, data: { user, menus }, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 登出（销毁会话）
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await query(`DELETE FROM user_session WHERE token = $1`, [req.token]);
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
