// madazi-llm-gateway -- 独立 LLM 网关（S2-2）
// 职责：鉴平台 key -> 转上游(DeepSeek/Ark) -> 计价 -> 写 usage_logs
// 原则：只读 api_keys/model_costs/settings，只写 usage_logs；无业务表；零依赖框架（仅 pg）
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.GATEWAY_PORT || 3459);
// 上游兜底（优先从 llm_configs 默认行读，管理端改配置网关 60s 内跟随）
const UPSTREAM_BASE_FALLBACK = (process.env.GATEWAY_UPSTREAM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
const KEY_MASTER_SECRET = process.env.KEY_MASTER_SECRET || '';
const DB_URL = process.env.DATABASE_URL || '';
if (!KEY_MASTER_SECRET) console.warn('[gateway] KEY_MASTER_SECRET 未设置（llm_configs 解密会失败）');
if (!DB_URL) console.error('[gateway] DATABASE_URL 未设置'), process.exit(1);

const pool = new Pool({ connectionString: DB_URL, max: 8 });

// ---------- 上游（llm_configs 默认行 + AES-256-GCM 解密，与 server keycrypto.js 同逻辑）----------
let upstreamCache = { base: UPSTREAM_BASE_FALLBACK, key: process.env.GATEWAY_UPSTREAM_KEY || '', model: '', at: 0 };
function decryptStored(stored) {
  const PREFIX = 'enc:v1:';
  if (!stored || !stored.startsWith(PREFIX)) return stored; // 明文旧数据原样
  const key = /^[0-9a-f]{64}$/i.test(KEY_MASTER_SECRET) ? Buffer.from(KEY_MASTER_SECRET, 'hex') : require('node:crypto').createHash('sha256').update(KEY_MASTER_SECRET).digest();
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
  } catch { return stored; }
}
async function getUpstream() {
  if (Date.now() - upstreamCache.at > CACHE_TTL) {
    try {
      // ★ 归属隔离：网关只认全局默认（user_id IS NULL），普通用户私有默认不走统一网关
      const r = await pool.query("SELECT base_url, api_key, model FROM llm_configs WHERE user_id IS NULL AND is_default LIMIT 1");
      if (r.rows[0]) {
        upstreamCache = { base: r.rows[0].base_url.replace(/\/+$/, ''), key: decryptStored(r.rows[0].api_key), model: r.rows[0].model, at: Date.now() };
      }
    } catch (e) { console.error('[gateway] 读 llm_configs 失败(用缓存):', e.message); }
  }
  return upstreamCache;
}

// ---------- 计价 ----------
let settingsCache = { usd_cny_rate: 7.2, at: 0 };
let costsCache = { map: new Map(), at: 0 };
const CACHE_TTL = 60_000;

async function getSettings() {
  if (Date.now() - settingsCache.at > CACHE_TTL) {
    const r = await pool.query("SELECT key, value FROM settings WHERE key IN ('usd_cny_rate','usage_default_input_price','usage_default_output_price')");
    const m = Object.fromEntries(r.rows.map(x => [x.key, x.value]));
    settingsCache = { usd_cny_rate: Number(m.usd_cny_rate ?? 7.2), in: Number(m.usage_default_input_price ?? 0.5), out: Number(m.usage_default_output_price ?? 1.5), at: Date.now() };
  }
  return settingsCache;
}
async function getCosts() {
  if (Date.now() - costsCache.at > CACHE_TTL) {
    const r = await pool.query('SELECT model, input_price_per_m, output_price_per_m, currency FROM model_costs');
    const map = new Map(r.rows.map(x => [x.model, x]));
    costsCache = { map, at: Date.now() };
  }
  return costsCache.map;
}
// cost_usd = (in_tokens * p_in + out_tokens * p_out) / 1e6，按币种折 USD
async function calcCostUsd(model, promptTokens, completionTokens) {
  const [costs, s] = await Promise.all([getCosts(), getSettings()]);
  const c = costs.get(model);
  const [pIn, pOut, isCny] = c ? [Number(c.input_price_per_m), Number(c.output_price_per_m), c.currency === 'CNY']
    : [s.in, s.out, false]; // 未定价模型：settings 默认价(USD)
  let usd = (promptTokens * pIn + completionTokens * pOut) / 1e6;
  if (isCny) usd = usd / s.usd_cny_rate;
  return Math.round(usd * 1e6) / 1e6;
}

// ---------- 鉴 key ----------
async function authKey(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(mz-[0-9a-f]{32})$/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const r = await pool.query(
    `SELECT k.id, k.user_id, u.username FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1 AND k.status = 'active'`, [hash]);
  return r.rows[0] || null;
}

// ---------- 记账 ----------
async function logUsage({ userId, model, promptTokens, completionTokens }) {
  try {
    const costUsd = await calcCostUsd(model, promptTokens, completionTokens);
    await pool.query(
      `INSERT INTO usage_logs (id, user_id, project_id, config_id, model, prompt_tokens, completion_tokens, cost_usd)
       VALUES ($1,$2,NULL,'gateway',$3,$4,$5,$6)`,
      [crypto.randomUUID(), userId, model, promptTokens, completionTokens, costUsd]);
    return costUsd;
  } catch (e) {
    console.error('[gateway] 记账失败(不中断请求):', e.message);
    return null;
  }
}

// ---------- 余额（DeepSeek 官方 /user/balance 形状仿真）----------
async function balanceHandler(req, res, keyInfo) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(cost_usd),0)::float AS spent FROM usage_logs WHERE user_id = $1 AND config_id = 'gateway'`, [keyInfo.user_id]);
  const spent = r.rows[0].spent;
  // 余额=预充值额度-已耗；单用户阶段先给固定额度，充值功能后置
  const GRANT_USD = Number(process.env.GATEWAY_GRANT_USD || 100);
  const balance = Math.max(0, GRANT_USD - spent);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    is_available: balance > 0,
    balance_infos: [{
      currency: 'CNY',
      total_balance: (balance * 7.2).toFixed(2),
      granted: (GRANT_USD * 7.2).toFixed(2),
      topped_up: '0.00',
      usage: (spent * 7.2).toFixed(2),
    }],
  }));
}

// ---------- 通用转发 ----------
async function proxyChat(req, res, keyInfo, body) {
  // 流式请求注入 include_usage 以便末块拿 token 数记账
  let parsed = {};
  try { parsed = JSON.parse(body); } catch {}
  if (parsed.stream) {
    parsed.stream_options = { include_usage: true };
    body = JSON.stringify(parsed);
  }

  const up0 = await getUpstream();
  const UPSTREAM_BASE = up0.base;
  const UPSTREAM_KEY = up0.key;
  if (!UPSTREAM_KEY) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'gateway: upstream key unavailable (llm_configs/ GATEWAY_UPSTREAM_KEY)' } }));
  }
  const up = new URL(UPSTREAM_BASE + '/chat/completions');
  const upReq = require("node:https").request({
    hostname: up.hostname, port: up.port || 443, path: up.pathname, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${UPSTREAM_KEY}`,
      'Content-Length': Buffer.byteLength(body),
    },
  }, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    if (!parsed.stream) {
      // 非流式：聚合后记账
      let buf = '';
      upRes.on('data', (c) => { buf += c; });
      upRes.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.usage) logUsage({ userId: keyInfo.user_id, model: j.model, promptTokens: j.usage.prompt_tokens, completionTokens: j.usage.completion_tokens });
        } catch {}
        res.end(buf);
      });
    } else {
      // 流式：透传 + 扫描末块 usage
      let usage = null, model = parsed.model || '';
      upRes.on('data', (c) => {
        res.write(c);
        const text = c.toString();
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            if (j.model) model = j.model;
            if (j.usage) usage = j.usage;
          } catch {}
        }
      });
      upRes.on('end', () => {
        res.end();
        if (usage) logUsage({ userId: keyInfo.user_id, model, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
      });
    }
  });
  upReq.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream error: ' + e.message } }));
  });
  upReq.end(body);
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const start = Date.now();

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
  }

  const keyInfo = await authKey(req).catch(() => null);
  if (!keyInfo) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
  }

  if (req.method === 'GET' && url.pathname === '/user/balance') return balanceHandler(req, res, keyInfo);

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    const costs = await getCosts();
    const data = [...costs.keys()].sort().map(m => ({ id: m, object: 'model', owned_by: 'madazi' }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data }));
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 16 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let model = '';
      try { model = JSON.parse(body).model || ''; } catch {}
      if (!model) { res.writeHead(400); return res.end('{"error":{"message":"missing model"}}'); }
      proxyChat(req, res, keyInfo, body).catch((e) => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'gateway: ' + e.message } }));
      });
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'not found' } }));
});
server.keepAliveTimeout = 3600_000;
server.headersTimeout = 3660_000;
server.listen(PORT, () => console.log(`[gateway] listening :${PORT} -> ${UPSTREAM_BASE_FALLBACK} (fallback base; live upstream follows llm_configs)`));
