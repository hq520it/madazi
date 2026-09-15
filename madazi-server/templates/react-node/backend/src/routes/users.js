import { Router } from 'express';
import { query, hashPassword } from '../db.js';
import { authMiddleware, requirePerm } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 唯一约束冲突 -> 400
function isUniqueErr(err) {
  return err.code === '23505' || err.code === '23P05' || /duplicate key/i.test(err.message || '');
}

// 列表（分页 + 搜索 + 状态筛选，附带角色）
router.get('/', requirePerm('system:user'), async (req, res) => {
  try {
    const page = Math.max(0, parseInt(req.query.page ?? '0', 10) || 0);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size ?? '20', 10) || 20));
    const search = (req.query.search ?? '').trim();
    const status = (req.query.status ?? '').trim();

    const where = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(username ILIKE $${params.length} OR nickname ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await query(`SELECT COUNT(*)::int AS c FROM user_account ${whereSql}`, params);
    const rows = await query(
      `SELECT id, username, nickname, email, phone, status, created_at, updated_at
       FROM user_account ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, page * size]
    );

    // 批量取角色
    const ids = rows.rows.map((r) => r.id);
    let roleMap = {};
    if (ids.length) {
      const roles = await query(
        `SELECT ur.user_id, r.id AS role_id, r.code, r.name FROM user_role ur
         JOIN role r ON r.id = ur.role_id WHERE ur.user_id = ANY($1::varchar[])`,
        [ids]
      );
      roleMap = roles.rows.reduce((acc, r) => {
        (acc[r.user_id] = acc[r.user_id] || []).push({ id: r.role_id, code: r.code, name: r.name });
        return acc;
      }, {});
    }
    const list = rows.rows.map((r) => ({ ...r, roles: roleMap[r.id] || [] }));

    res.json({ code: 200, data: { list, total: total.rows[0].c, page, size }, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 新增（username + 初始密码 + 角色）
router.post('/', requirePerm('system:user:add'), async (req, res) => {
  try {
    const { username, password, nickname, email, phone, status, roleIds = [] } = req.body || {};
    if (!username || !password) return res.status(400).json({ code: 400, message: '用户名和密码必填' });
    if (String(password).length < 6) return res.status(400).json({ code: 400, message: '密码至少 6 位' });

    const { salt, hash } = hashPassword(String(password));
    const r = await query(
      `INSERT INTO user_account (username, password_hash, password_salt, nickname, email, phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, nickname, email, phone, status, created_at, updated_at`,
      [username, hash, salt, nickname ?? null, email ?? null, phone ?? null, status ?? '1']
    );
    const user = r.rows[0];
    for (const rid of roleIds) {
      await query(`INSERT INTO user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [user.id, rid]);
    }
    res.status(201).json({ code: 201, data: user, message: 'success' });
  } catch (err) {
    if (isUniqueErr(err)) return res.status(400).json({ code: 400, message: '用户名已存在' });
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 编辑（基础信息 + 角色，不含密码）
router.put('/:id', requirePerm('system:user:edit'), async (req, res) => {
  try {
    const { nickname, email, phone, status, roleIds } = req.body || {};
    const r = await query(
      `UPDATE user_account SET nickname = $1, email = $2, phone = $3, status = $4, updated_at = NOW()
       WHERE id = $5 RETURNING id, username, nickname, email, phone, status, created_at, updated_at`,
      [nickname ?? null, email ?? null, phone ?? null, status ?? '1', req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ code: 404, message: '用户不存在' });
    if (Array.isArray(roleIds)) {
      await query(`DELETE FROM user_role WHERE user_id = $1`, [req.params.id]);
      for (const rid of roleIds) {
        await query(`INSERT INTO user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.id, rid]);
      }
    }
    res.json({ code: 200, data: r.rows[0], message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 重置密码
router.put('/:id/password', requirePerm('system:user:resetPwd'), async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ code: 400, message: '密码至少 6 位' });
    }
    const { salt, hash } = hashPassword(String(password));
    const r = await query(
      `UPDATE user_account SET password_hash = $1, password_salt = $2, updated_at = NOW() WHERE id = $3 RETURNING id`,
      [hash, salt, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ code: 404, message: '用户不存在' });
    // 重置密码后踢掉该用户所有会话
    await query(`DELETE FROM user_session WHERE user_id = $1`, [req.params.id]);
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 删除
router.delete('/:id', requirePerm('system:user:delete'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ code: 400, message: '不能删除自己' });
    const u = await query(`SELECT username FROM user_account WHERE id = $1`, [req.params.id]);
    if (u.rows.length === 0) return res.status(404).json({ code: 404, message: '用户不存在' });
    if (u.rows[0].username === 'admin') return res.status(400).json({ code: 400, message: '内置管理员不可删除' });
    await query(`DELETE FROM user_role WHERE user_id = $1`, [req.params.id]);
    await query(`DELETE FROM user_session WHERE user_id = $1`, [req.params.id]);
    await query(`DELETE FROM user_preference WHERE user_id = $1`, [req.params.id]);
    await query(`DELETE FROM user_account WHERE id = $1`, [req.params.id]);
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
