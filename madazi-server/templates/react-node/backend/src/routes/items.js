import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware, requirePerm } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 列表（分页 + 搜索 + 分类/状态筛选）
router.get('/', requirePerm('demo:item'), async (req, res) => {
  try {
    const page = Math.max(0, parseInt(req.query.page ?? '0', 10) || 0);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size ?? '20', 10) || 20));
    const search = (req.query.search ?? '').trim();
    const { category = '', status = '' } = req.query;

    const where = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await query(`SELECT COUNT(*)::int AS c FROM item ${whereSql}`, params);
    const rows = await query(
      `SELECT * FROM item ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, page * size]
    );
    res.json({ code: 200, data: { list: rows.rows, total: total.rows[0].c, page, size }, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 详情
router.get('/:id', requirePerm('demo:item'), async (req, res) => {
  try {
    const result = await query(`SELECT * FROM item WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ code: 404, message: 'Not found' });
    res.json({ code: 200, data: result.rows[0], message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 创建
router.post('/', requirePerm('demo:item:add'), async (req, res) => {
  try {
    const { name, description, category, status } = req.body || {};
    if (!name) return res.status(400).json({ code: 400, message: 'name 必填' });
    const result = await query(
      `INSERT INTO item (name, description, category, status) VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description ?? null, category ?? null, status ?? '1']
    );
    res.status(201).json({ code: 201, data: result.rows[0], message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 更新
router.put('/:id', requirePerm('demo:item:edit'), async (req, res) => {
  try {
    const { name, description, category, status } = req.body || {};
    const result = await query(
      `UPDATE item SET name = $1, description = $2, category = $3, status = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name, description ?? null, category ?? null, status ?? '1', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ code: 404, message: 'Not found' });
    res.json({ code: 200, data: result.rows[0], message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 删除
router.delete('/:id', requirePerm('demo:item:delete'), async (req, res) => {
  try {
    const result = await query(`DELETE FROM item WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ code: 404, message: 'Not found' });
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
