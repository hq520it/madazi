import { db } from '../db/init.js';
import { v4 as uuid } from 'uuid';
import { getSettingNumber } from './settings.js';

/**
 * 用量计量服务（P0-2）
 * - logUsage: 每次 LLM 调用完成后记录（token 估算 + 成本）
 * - checkQuota: 对话前配额检查（今日已用 tokens vs 限额）
 * - 统计查询: 供管理端用量面板使用
 *
 * 说明：流式响应拿不到精确 usage（未开 include_usage），用字符数估算：
 *   1 token ≈ 4 chars（中文约 1 字 ≈ 1 token，英文 4 chars ≈ 1 token，折中取 4）
 */

// 中英混合估算：CJK 字符按 1 token/字，其余按 4 chars/token
export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk + other / 4);
}

/** 取模型单价（官方币种 + 每百万 token 价）；未配置返回 null（不估算） */
export async function getModelPrice(model) {
  const { rows } = await db.query(
    'SELECT currency, input_price_per_m, output_price_per_m FROM model_costs WHERE model = $1 LIMIT 1',
    [model]
  );
  if (!rows[0]) return null;
  return {
    currency: rows[0].currency || 'USD',
    input: Number(rows[0].input_price_per_m),
    output: Number(rows[0].output_price_per_m),
  };
}

/** 官方币种价 → USD（usage_logs.cost_usd 统一记账）；CNY 按 settings 汇率，USD 原值 */
async function toUsd(amount, currency) {
  if (!amount) return 0;
  if (currency === 'CNY') {
    const rate = await getSettingNumber('usd_cny_rate', 7.2);
    return amount / rate;
  }
  return amount;
}

/**
 * 记录一次用量（静默失败，绝不阻塞主流程）
 * @param {object} opts { userId, projectId, configId, model, promptText, completionText }
 */
export async function logUsage({ userId, projectId, configId, model, promptText, completionText }) {
  try {
    const promptTokens = estimateTokens(promptText);
    const completionTokens = estimateTokens(completionText);
    if (promptTokens + completionTokens === 0) return;
    const price = await getModelPrice(model);
    // 成本统一折 USD 记账；无官方价的模型 cost_usd=0（不瞎猜）
    let costUsd = 0;
    if (price) {
      costUsd =
        (await toUsd((promptTokens / 1_000_000) * price.input, price.currency)) +
        (await toUsd((completionTokens / 1_000_000) * price.output, price.currency));
    }
    await db.query(
      `INSERT INTO usage_logs (id, user_id, project_id, config_id, model, prompt_tokens, completion_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), userId || null, projectId || null, configId || null, model, promptTokens, completionTokens, costUsd]
    );
  } catch (err) {
    console.error('记录用量失败（忽略）:', err.message);
  }
}

/**
 * 记录一次精确用量（dsh Agent：usage 来自 session 快照明文，不估算）
 * @param {object} opts { userId, projectId, model, inputTokens, outputTokens, cacheReadTokens }
 */
export async function logExactUsage({ userId, projectId, model, inputTokens, outputTokens, cacheReadTokens = 0 }) {
  try {
    const promptTokens = inputTokens || 0;
    const completionTokens = outputTokens || 0;
    if (promptTokens + completionTokens === 0) return;
    const price = await getModelPrice(model);
    // 缓存读取按输入价的 1/10 计（DeepSeek 官方缓存命中价 ≈ 输入价 1/10）
    let costUsd = 0;
    if (price) {
      const cacheInput = (cacheReadTokens / 1_000_000) * price.input * 0.1;
      costUsd =
        (await toUsd((promptTokens / 1_000_000) * price.input + cacheInput, price.currency)) +
        (await toUsd((completionTokens / 1_000_000) * price.output, price.currency));
    }
    await db.query(
      `INSERT INTO usage_logs (id, user_id, project_id, config_id, model, prompt_tokens, completion_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), userId || null, projectId || null, null, model, promptTokens, completionTokens, costUsd]
    );
  } catch (err) {
    console.error('记录精确用量失败（忽略）:', err.message);
  }
}

/** 今日已用 tokens（含 history 窗口，按天自然日 UTC+8） */
export async function getTodayUsage(userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::int AS total
     FROM usage_logs
     WHERE user_id = $1 AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`,
    [userId]
  );
  return Number(rows[0]?.total || 0);
}

/**
 * 配额检查（对话前调用）
 * @returns {Promise<{allowed: boolean, used: number, limit: number}>}
 */
// ★ P2 B9：并发预留——消除 check-then-act 竞态（LLM 调用 1-15 分钟窗口内
// 多个并发请求都读「历史用量」通过检查 → 实际总量超限）。
// 对话开始 reserveQuota（预扣估算值），结束 releaseReservation（logUsage 落明细后释放）。
// 单实例内存态（server 当前单副本）；多副本部署时需换 Redis 原子计数。
const pendingReservations = new Map(); // userId -> {tokens, ts}
const RESERVATION_TTL = 10 * 60 * 1000; // 预留 10 分钟自动释放（防异常路径泄漏——LLM 调用最长约 15min，预留最多 10min 无害）
export function reserveQuota(userId, estimateTokens) {
  if (!userId || !estimateTokens || estimateTokens <= 0) return;
  const cur = pendingReservations.get(userId);
  pendingReservations.set(userId, { tokens: (cur?.tokens || 0) + Math.ceil(estimateTokens), ts: Date.now() });
}
export function releaseReservation(userId, estimateTokens) {
  if (!userId || !estimateTokens || estimateTokens <= 0) return;
  const cur = pendingReservations.get(userId);
  if (!cur) return;
  const next = cur.tokens - Math.ceil(estimateTokens);
  if (next <= 0) pendingReservations.delete(userId);
  else pendingReservations.set(userId, { tokens: next, ts: Date.now() });
}
export async function checkQuota(userId) {
  if (!userId) return { allowed: true, used: 0, limit: 0 };
  // 清理过期预留（异常路径泄漏的兜底）
  const now = Date.now();
  for (const [uid, r] of pendingReservations) {
    if (now - r.ts > RESERVATION_TTL) pendingReservations.delete(uid);
  }
  const used = await getTodayUsage(userId);

  // 用户级覆盖：NULL=全局默认，0=不限
  const { rows } = await db.query('SELECT daily_tokens_limit FROM user_quotas WHERE user_id = $1', [userId]);
  let limit = rows[0]?.daily_tokens_limit;
  if (limit === null || limit === undefined) {
    limit = await getSettingNumber('daily_tokens_limit', 0);
  }
  limit = Number(limit) || 0;

  const usedWithPending = used + (pendingReservations.get(userId) || 0);

  return { allowed: limit === 0 || usedWithPending < limit, used: usedWithPending, limit };
}

/** 配额错误（调用方转 429） */
export class QuotaExceededError extends Error {
  constructor(used, limit) {
    super(`今日用量已达上限（${used.toLocaleString()} / ${limit.toLocaleString()} tokens），请联系管理员调整配额`);
    this.name = 'QuotaExceededError';
    this.used = used;
    this.limit = limit;
  }
}

// ====== 管理端统计 ======

/**
 * 汇总统计
 * @param {number} days 时间窗口天数
 * @param {string} [userId] 按用户过滤
 * @param {string} [projectId] 按项目过滤
 * @returns {{ total: {calls,tokens,cost}, byDay: [], byUser: [], byModel: [], byProject: [] }}
 */
export async function getUsageSummary({ days = 7, userId, projectId } = {}) {
  const where = ['l.created_at >= NOW() - ($1 || \' days\')::interval'];
  const params = [String(days)];
  if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
  if (projectId) { params.push(projectId); where.push(`project_id = $${params.length}`); }
  const whereSql = where.join(' AND ');

  const [total, byDay, byUser, byModel, byProject] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS calls,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint AS tokens,
              COALESCE(SUM(cost_usd), 0)::float AS cost
       FROM usage_logs l WHERE ${whereSql}`, params),
    db.query(
      `SELECT to_char(l.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD') AS day,
              COUNT(*)::int AS calls,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint AS tokens,
              COALESCE(SUM(cost_usd), 0)::float AS cost
       FROM usage_logs l WHERE ${whereSql}
       GROUP BY day ORDER BY day`, params),
    db.query(
      `SELECT u.username, u.role, COUNT(l.*)::int AS calls,
              COALESCE(SUM(l.prompt_tokens + l.completion_tokens), 0)::bigint AS tokens,
              COALESCE(SUM(l.cost_usd), 0)::float AS cost
       FROM usage_logs l LEFT JOIN users u ON u.id = l.user_id
       WHERE ${whereSql} GROUP BY u.username, u.role ORDER BY tokens DESC`, params),
    db.query(
      `SELECT l.model, COUNT(*)::int AS calls,
              COALESCE(SUM(l.prompt_tokens + l.completion_tokens), 0)::bigint AS tokens,
              COALESCE(SUM(l.cost_usd), 0)::float AS cost
       FROM usage_logs l WHERE ${whereSql}
       GROUP BY l.model ORDER BY tokens DESC`, params),
    db.query(
      `SELECT p.name AS project_name, COUNT(l.*)::int AS calls,
              COALESCE(SUM(l.prompt_tokens + l.completion_tokens), 0)::bigint AS tokens,
              COALESCE(SUM(l.cost_usd), 0)::float AS cost
       FROM usage_logs l LEFT JOIN projects p ON p.id = l.project_id
       WHERE ${whereSql} GROUP BY p.name ORDER BY tokens DESC`, params),
  ]);

  return {
    days,
    total: total.rows[0] || { calls: 0, tokens: 0, cost: 0 },
    byDay: byDay.rows,
    byUser: byUser.rows,
    byModel: byModel.rows,
    byProject: byProject.rows,
  };
}

/** 明细分页 */
export async function getUsageLogs({ page = 1, pageSize = 20, userId, model } = {}) {
  const where = ['1=1'];
  const params = [];
  if (userId) { params.push(userId); where.push(`l.user_id = $${params.length}`); }
  if (model) { params.push(model); where.push(`l.model = $${params.length}`); }
  const whereSql = where.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [logs, count] = await Promise.all([
    db.query(
      `SELECT l.id, l.model, l.prompt_tokens, l.completion_tokens, l.cost_usd, l.created_at,
              u.username, p.name AS project_name
       FROM usage_logs l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN projects p ON p.id = l.project_id
       WHERE ${whereSql} ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]),
    db.query(`SELECT COUNT(*)::int AS total FROM usage_logs l WHERE ${whereSql}`, params),
  ]);
  return { logs: logs.rows, total: count.rows[0].total, page, pageSize };
}

/** 配额列表（所有用户 + 今日用量） */
export async function getQuotaList() {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.role, q.daily_tokens_limit,
            COALESCE(SUM(l.prompt_tokens + l.completion_tokens), 0)::bigint AS today_tokens
     FROM users u
     LEFT JOIN user_quotas q ON q.user_id = u.id
     LEFT JOIN usage_logs l ON l.user_id = u.id
        AND l.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
     GROUP BY u.id, u.username, u.role, q.daily_tokens_limit
     ORDER BY today_tokens DESC`)
  ;
  return rows;
}

/** 设置用户配额（0=不限；null/省略=跟随全局） */
export async function setUserQuota(userId, limit) {
  if (limit === null || limit === undefined) {
    await db.query('DELETE FROM user_quotas WHERE user_id = $1', [userId]);
  } else {
    await db.query(
      `INSERT INTO user_quotas (user_id, daily_tokens_limit, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (user_id) DO UPDATE SET daily_tokens_limit = $2, updated_at = NOW()`,
      [userId, Math.max(0, Math.floor(Number(limit) || 0))]
    );
  }
  return { ok: true };
}
