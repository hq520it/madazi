import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 仪表盘统计（登录即可）
router.get('/stats', async (req, res) => {
  try {
    const [users, roles, dicts, items, recent] = await Promise.all([
      query(`SELECT COUNT(*)::int AS c FROM user_account WHERE status = '1'`),
      query(`SELECT COUNT(*)::int AS c FROM role WHERE status = '1'`),
      query(`SELECT COUNT(*)::int AS c FROM dict_type`),
      query(`SELECT COUNT(*)::int AS c FROM item`),
      query(`SELECT id, name, description, category, status, created_at FROM item ORDER BY created_at DESC LIMIT 5`),
    ]);
    res.json({
      code: 200,
      data: {
        userCount: users.rows[0].c,
        roleCount: roles.rows[0].c,
        dictCount: dicts.rows[0].c,
        itemCount: items.rows[0].c,
        recentItems: recent.rows,
      },
      message: 'success',
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
