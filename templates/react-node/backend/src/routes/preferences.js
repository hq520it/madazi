import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 读取当前用户某页面的偏好配置（无则返回 null，前端用默认值）
router.get('/:pageCode', async (req, res) => {
  try {
    const r = await query(
      `SELECT config FROM user_preference WHERE user_id = $1 AND page_code = $2`,
      [req.user.id, req.params.pageCode]
    );
    res.json({ code: 200, data: r.rows.length ? r.rows[0].config : null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 保存（upsert，只能写自己的）
router.put('/:pageCode', async (req, res) => {
  try {
    const config = req.body?.config;
    if (config == null || typeof config !== 'object') {
      return res.status(400).json({ code: 400, message: 'config 必须是对象' });
    }
    await query(
      `INSERT INTO user_preference (user_id, page_code, config)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, page_code) DO UPDATE SET config = $3, updated_at = NOW()`,
      [req.user.id, req.params.pageCode, JSON.stringify(config)]
    );
    res.json({ code: 200, data: null, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
