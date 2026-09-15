import { Router } from 'express';
import { all, get, run } from '../db.js';

const router = Router();

// 列表
router.get('/', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM item ORDER BY created_at DESC');
    res.json({ code: 200, data: rows, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 创建
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ code: 400, message: 'name 必填' });
    const row = await get(
      'INSERT INTO item (name, description) VALUES (?, ?) RETURNING *',
      [name, description || null]
    );
    res.status(201).json({ code: 201, data: row, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 更新
router.put('/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const existing = await get('SELECT id FROM item WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ code: 404, message: 'Not found' });
    await run(
      'UPDATE item SET name = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [name, description, req.params.id]
    );
    res.json({ code: 200, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 删除
router.delete('/:id', async (req, res) => {
  try {
    const existing = await get('SELECT id FROM item WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ code: 404, message: 'Not found' });
    await run('DELETE FROM item WHERE id = ?', [req.params.id]);
    res.json({ code: 200, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
