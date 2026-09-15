import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// 列表
router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM items ORDER BY created_at DESC');
  res.json(rows);
});

// 详情
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// 创建
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name 不能为空' });
  const { rows } = await pool.query(
    'INSERT INTO items (name, description) VALUES ($1, $2) RETURNING *',
    [name, description || '']
  );
  res.status(201).json(rows[0]);
});

// 更新
router.put('/:id', async (req, res) => {
  const { name, description, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE items
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [name ?? null, description ?? null, status ?? null, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// 删除
router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
