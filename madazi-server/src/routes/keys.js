import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db/init.js';
import { auth } from '../middleware/auth.js';

/**
 * S2-2 平台 per-user key 管理（key-server）
 * - key 格式 mz-<32hex>，明文仅签发时返回一次，库中存 sha256
 * - 复用 auth 中间件；admin 可管理全部用户 key，普通用户只看自己
 */

const router = Router();

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function genKey() {
  return 'mz-' + crypto.randomBytes(16).toString('hex');
}

// 列表（admin 可带 ?userId= 看指定用户；普通用户只看自己）
router.get('/', auth, async (req, res) => {
  try {
    const { userId } = req.query;
    const target = req.user.role === 'admin' && userId ? userId : req.user.id;
    const r = await db.query(
      `SELECT k.id, k.user_id, k.name, k.key_prefix, k.status, k.created_at, k.revoked_at, u.username
       FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.user_id = $1 ORDER BY k.created_at DESC`, [target]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// admin：全部用户 key 列表（管理端用）
router.get('/all', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  try {
    const r = await db.query(
      `SELECT k.id, k.user_id, k.name, k.key_prefix, k.status, k.created_at, k.revoked_at, u.username
       FROM api_keys k JOIN users u ON u.id = k.user_id
       ORDER BY k.created_at DESC LIMIT 500`);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 签发（admin 可为任意用户；普通用户只能为自己）明文只此一次
router.post('/', auth, async (req, res) => {
  try {
    const target = req.user.role === 'admin' && req.body.userId ? req.body.userId : req.user.id;
    const name = String(req.body.name || '').slice(0, 100);
    // 每用户最多 5 把活跃 key
    const cnt = await db.query(
      `SELECT COUNT(*)::int AS n FROM api_keys WHERE user_id = $1 AND status = 'active'`, [target]);
    if (cnt.rows[0].n >= 5) return res.status(400).json({ error: '每用户最多 5 把活跃 key' });

    const key = genKey();
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, status) VALUES ($1,$2,$3,$4,$5,'active')`,
      [id, target, name, sha256(key), key.slice(0, 10)]);
    res.json({ id, key, name, key_prefix: key.slice(0, 10), userId: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 吊销
router.delete('/:id', auth, async (req, res) => {
  try {
    const r = await db.query(`SELECT user_id FROM api_keys WHERE id = $1`, [req.params.id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await db.query(`UPDATE api_keys SET status = 'revoked', revoked_at = now() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 自动签发（dsh-workbench 插件用）：轮换制——吊销该用户全部活跃 key 后签发一把新 key
// 明文仅此一次；client.js 注入成功后幂等跳过（路由+key 已配置时不调本端点）
router.post('/provision', auth, async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || 'auto').slice(0, 100);
    // 轮换：吊销旧的，避免明文不可恢复导致 409 卡死注入
    await db.query(
      `UPDATE api_keys SET status = 'revoked', revoked_at = now() WHERE user_id = $1 AND status = 'active'`,
      [req.user.id]);
    const key = genKey();
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, status) VALUES ($1,$2,$3,$4,$5,'active')`,
      [id, req.user.id, name, sha256(key), key.slice(0, 10)]);
    // 模型清单给 BYOK 注入用
    let models = [];
    try {
      const m = await db.query(`SELECT model FROM model_costs ORDER BY model`);
      models = m.rows.map((r) => r.model);
    } catch (e) { /* model_costs 缺失时给兜底 */ }
    if (!models.length) models = ['deepseek-chat'];
    res.json({ id, key, name, key_prefix: key.slice(0, 10), models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 用户用量汇总（key 面板用；gateway 记的账 config_id='gateway'）
router.get('/usage/summary', auth, async (req, res) => {
  try {
    const target = req.user.role === 'admin' && req.query.userId ? req.query.userId : req.user.id;
    const r = await db.query(
      `SELECT COALESCE(SUM(prompt_tokens),0)::int AS prompt_tokens,
              COALESCE(SUM(completion_tokens),0)::int AS completion_tokens,
              COALESCE(SUM(cost_usd),0)::float AS cost_usd,
              COUNT(*)::int AS calls
       FROM usage_logs WHERE user_id = $1 AND config_id = 'gateway'`, [target]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
