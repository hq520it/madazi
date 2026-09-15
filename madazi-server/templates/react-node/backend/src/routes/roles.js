import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware, requirePerm } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

function isUniqueErr(err) {
  return err.code === '23505' || err.code === '23P05' || /duplicate key/i.test(err.message || '');
}

// 角色列表（分页 + 搜索）
router.get('/', requirePerm('system:role'), async (req, res) => {
  try {
    const page = Math.max(0, parseInt(req.query.page ?? '0', 10) || 0);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size ?? '20', 10) || 20));
    const search = (req.query.search ?? '').trim();

    const where = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await query(`SELECT COUNT(*)::int AS c FROM role ${whereSql}`, params);
    const rows = await query(
      `SELECT id, code, name, description, status, created_at, updated_at
       FROM role ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, page * size]
    );

    // 附带每个角色的用户数
    const ids = rows.rows.map((r) => r.id);
    let userCountMap = {};
    if (ids.length) {
      const counts = await query(
        `SELECT role_id, COUNT(*)::int AS c FROM user_role WHERE role_id = ANY($1::varchar[]) GROUP BY role_id`,
        [ids]
      );
      userCountMap = Object.fromEntries(counts.rows.map((c) => [c.role_id, c.c]));
    }
    const list = rows.rows.map((r) => ({ ...r, userCount: userCountMap[r.id] || 0 }));

    res.json({ code: 200, data: { list, total: total.rows[0].c, page, size }, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 全部角色（不分页，用户编辑弹窗用）
router.get('/all', requirePerm('system:user'), async (req, res) => {
  try {
    const rows = await query(`SELECT id, code, name FROM role WHERE status = '1' ORDER BY name`);
    res.json({ code: 200, data: rows.rows, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 角色详情（含已授权菜单 ids）
router.get('/:id', requirePerm('system:role'), async (req, res) => {
  try {
    const r = await query(`SELECT id, code, name, description, status FROM role WHERE id = $1`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ code: 404, message: '角色不存在' });
    const menus = await query(`SELECT menu_id FROM role_menu WHERE role_id = $1`, [req.params.id]);
    res.json({ code: 200, data: { ...r.rows[0], menuIds: menus.rows.map((m) => m.menu_id) }, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 角色授权用的完整菜单树（拥有角色编辑权限即可取）
router.get('/menu-tree/all', requirePerm('system:role'), async (req, res) => {
  try {
    const rows = await query(`SELECT id, parent_id, code, name, type, sort FROM menu ORDER BY sort`);
    res.json({ code: 200, data: rows.rows, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 新增角色
router.post('/', requirePerm('system:role:add'), async (req, res) => {
  try {
    const { code, name, description, status, menuIds = [] } = req.body || {};
    if (!code || !name) return res.status(400).json({ code: 400, message: '角色标识和名称必填' });
    const r = await query(
      `INSERT INTO role (code, name, description, status) VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, description, status, created_at, updated_at`,
      [code, name, description ?? null, status ?? '1']
    );
    for (const mid of menuIds) {
      await query(`INSERT INTO role_menu (role_id, menu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [r.rows[0].id, mid]);
    }
    res.status(201).json({ code: 201, data: r.rows[0], message: 'success' });
  } catch (err) {
    if (isUniqueErr(err)) return res.status(400).json({ code: 400, message: '角色标识已存在' });
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 编辑角色（含重新授权菜单）
router.put('/:id', requirePerm('system:role:edit'), async (req, res) => {
  try {
    const { code, name, description, status, menuIds } = req.body || {};
    const r = await query(
      `UPDATE role SET code = $1, name = $2, description = $3, status = $4, updated_at = NOW()
       WHERE id = $5 RETURNING id, code, name, description, status, created_at, updated_at`,
      [code, name, description ?? null, status ?? '1', req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ code: 404, message: '角色不存在' });
    if (Array.isArray(menuIds)) {
      await query(`DELETE FROM role_menu WHERE role_id = $1`, [req.params.id]);
      for (const mid of menuIds) {
        await query(`INSERT INTO role_menu (role_id, menu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.params.id, mid]);
      }
    }
    res.json({ code: 200, data: r.rows[0], message: 'success' });
  } catch (err) {
    if (isUniqueErr(err)) return res.status(400).json({ code: 400, message: '角色标识已存在' });
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 删除角色
router.delete('/:id', requirePerm('system:role:delete'), async (req, res) => {
  try {
    const r = await query(`SELECT code FROM role WHERE id = $1`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ code: 404, message: '角色不存在' });
    if (r.rows[0].code === 'super_admin') return res.status(400).json({ code: 400, message: '内置超级管理员角色不可删除' });
    await query(`DELETE FROM user_role WHERE role_id = $1`, [req.params.id]);
    await query(`DELETE FROM role_menu WHERE role_id = $1`, [req.params.id]);
    await query(`DELETE FROM role WHERE id = $1`, [req.params.id]);
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
