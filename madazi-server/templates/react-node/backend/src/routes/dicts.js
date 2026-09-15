import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware, requirePerm } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

function isUniqueErr(err) {
  return err.code === '23505' || err.code === '23P05' || /duplicate key/i.test(err.message || '');
}

// ============ 全量字典（登录即可，供下拉/标签渲染缓存） ============
router.get('/all', async (req, res) => {
  try {
    const types = await query(`SELECT code, name FROM dict_type WHERE status = '1' ORDER BY name`);
    const items = await query(
      `SELECT type_code, label, value, color, sort FROM dict_item WHERE status = '1' ORDER BY sort`
    );
    const data = types.rows.map((t) => ({
      ...t,
      items: items.rows.filter((i) => i.type_code === t.code),
    }));
    res.json({ code: 200, data, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ============ 字典类型 ============
router.get('/types', requirePerm('system:dict'), async (req, res) => {
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

    const total = await query(`SELECT COUNT(*)::int AS c FROM dict_type ${whereSql}`, params);
    const rows = await query(
      `SELECT * FROM dict_type ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, page * size]
    );

    // 附带字典项数量
    const codes = rows.rows.map((r) => r.code);
    let countMap = {};
    if (codes.length) {
      const counts = await query(
        `SELECT type_code, COUNT(*)::int AS c FROM dict_item WHERE type_code = ANY($1::varchar[]) GROUP BY type_code`,
        [codes]
      );
      countMap = Object.fromEntries(counts.rows.map((c) => [c.type_code, c.c]));
    }
    const list = rows.rows.map((r) => ({ ...r, itemCount: countMap[r.code] || 0 }));

    res.json({ code: 200, data: { list, total: total.rows[0].c, page, size }, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/types', requirePerm('system:dict:add'), async (req, res) => {
  try {
    const { code, name, description, status } = req.body || {};
    if (!code || !name) return res.status(400).json({ code: 400, message: '字典编码和名称必填' });
    const r = await query(
      `INSERT INTO dict_type (code, name, description, status) VALUES ($1, $2, $3, $4) RETURNING *`,
      [code, name, description ?? null, status ?? '1']
    );
    res.status(201).json({ code: 201, data: r.rows[0], message: 'success' });
  } catch (err) {
    if (isUniqueErr(err)) return res.status(400).json({ code: 400, message: '字典编码已存在' });
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.put('/types/:id', requirePerm('system:dict:edit'), async (req, res) => {
  try {
    const { code, name, description, status } = req.body || {};
    // 先取旧 code，用于编码变更时同步字典项
    const old = await query(`SELECT code FROM dict_type WHERE id = $1`, [req.params.id]);
    if (old.rows.length === 0) return res.status(404).json({ code: 404, message: '字典类型不存在' });
    const r = await query(
      `UPDATE dict_type SET code = $1, name = $2, description = $3, status = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [code, name, description ?? null, status ?? '1', req.params.id]
    );
    if (old.rows[0].code !== code) {
      await query(`UPDATE dict_item SET type_code = $1 WHERE type_code = $2`, [code, old.rows[0].code]);
    }
    res.json({ code: 200, data: r.rows[0], message: 'success' });
  } catch (err) {
    if (isUniqueErr(err)) return res.status(400).json({ code: 400, message: '字典编码已存在' });
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.delete('/types/:id', requirePerm('system:dict:delete'), async (req, res) => {
  try {
    const t = await query(`SELECT code FROM dict_type WHERE id = $1`, [req.params.id]);
    if (t.rows.length === 0) return res.status(404).json({ code: 404, message: '字典类型不存在' });
    await query(`DELETE FROM dict_item WHERE type_code = $1`, [t.rows[0].code]);
    await query(`DELETE FROM dict_type WHERE id = $1`, [req.params.id]);
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ============ 字典项 ============
router.get('/items', requirePerm('system:dict'), async (req, res) => {
  try {
    const typeCode = req.query.typeCode ?? '';
    if (!typeCode) return res.status(400).json({ code: 400, message: 'typeCode 必填' });
    const rows = await query(`SELECT * FROM dict_item WHERE type_code = $1 ORDER BY sort`, [typeCode]);
    res.json({ code: 200, data: rows.rows, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/items', requirePerm('system:dict:edit'), async (req, res) => {
  try {
    const { type_code, label, value, color, sort, status } = req.body || {};
    if (!type_code || !label || !value) return res.status(400).json({ code: 400, message: '字典编码、标签、键值必填' });
    const r = await query(
      `INSERT INTO dict_item (type_code, label, value, color, sort, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [type_code, label, value, color ?? 'default', sort ?? 0, status ?? '1']
    );
    res.status(201).json({ code: 201, data: r.rows[0], message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.put('/items/:id', requirePerm('system:dict:edit'), async (req, res) => {
  try {
    const { type_code, label, value, color, sort, status } = req.body || {};
    const r = await query(
      `UPDATE dict_item SET type_code = $1, label = $2, value = $3, color = $4, sort = $5, status = $6, updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [type_code, label, value, color ?? 'default', sort ?? 0, status ?? '1', req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ code: 404, message: '字典项不存在' });
    res.json({ code: 200, data: r.rows[0], message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.delete('/items/:id', requirePerm('system:dict:edit'), async (req, res) => {
  try {
    await query(`DELETE FROM dict_item WHERE id = $1`, [req.params.id]);
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
