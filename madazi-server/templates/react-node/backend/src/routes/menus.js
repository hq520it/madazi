import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware, requirePerm } from '../middleware/auth.js';
import { buildTree } from '../utils/tree.js';

const router = Router();
router.use(authMiddleware);

function isUniqueErr(err) {
  return err.code === '23505' || err.code === '23P05' || /duplicate key/i.test(err.message || '');
}

// 全部菜单（扁平，前端组树）
router.get('/', requirePerm('system:menu'), async (req, res) => {
  try {
    const rows = await query(`SELECT * FROM menu ORDER BY sort`);
    res.json({ code: 200, data: buildTree(rows.rows), message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 新增菜单/按钮
router.post('/', requirePerm('system:menu:add'), async (req, res) => {
  try {
    const { parent_id, code, name, path, icon, sort, type, status } = req.body || {};
    if (!code || !name) return res.status(400).json({ code: 400, message: '权限标识和名称必填' });
    if ((type ?? 'menu') === 'menu' && !path) return res.status(400).json({ code: 400, message: '菜单必须配置路由路径' });
    const r = await query(
      `INSERT INTO menu (parent_id, code, name, path, icon, sort, type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [parent_id || null, code, name, path ?? null, icon ?? null, sort ?? 0, type ?? 'menu', status ?? '1']
    );
    res.status(201).json({ code: 201, data: r.rows[0], message: 'success' });
  } catch (err) {
    if (isUniqueErr(err)) return res.status(400).json({ code: 400, message: '权限标识已存在' });
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 编辑菜单
router.put('/:id', requirePerm('system:menu:edit'), async (req, res) => {
  try {
    const { parent_id, code, name, path, icon, sort, type, status } = req.body || {};
    if (parent_id && parent_id === req.params.id) {
      return res.status(400).json({ code: 400, message: '上级菜单不能是自己' });
    }
    const r = await query(
      `UPDATE menu SET parent_id = $1, code = $2, name = $3, path = $4, icon = $5, sort = $6, type = $7, status = $8, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [parent_id || null, code, name, path ?? null, icon ?? null, sort ?? 0, type ?? 'menu', status ?? '1', req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ code: 404, message: '菜单不存在' });
    res.json({ code: 200, data: r.rows[0], message: 'success' });
  } catch (err) {
    if (isUniqueErr(err)) return res.status(400).json({ code: 400, message: '权限标识已存在' });
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 删除菜单（有子节点时拒绝）
router.delete('/:id', requirePerm('system:menu:delete'), async (req, res) => {
  try {
    const child = await query(`SELECT id FROM menu WHERE parent_id = $1 LIMIT 1`, [req.params.id]);
    if (child.rows.length > 0) return res.status(400).json({ code: 400, message: '存在子菜单，请先删除子节点' });
    await query(`DELETE FROM role_menu WHERE menu_id = $1`, [req.params.id]);
    await query(`DELETE FROM menu WHERE id = $1`, [req.params.id]);
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
