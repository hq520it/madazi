import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/init.js';
import { auth } from '../middleware/auth.js';
import { adminOnly } from '../middleware/auth.js';
import { encryptKey, decryptKey } from '../services/keycrypto.js';

const router = Router();

// 所有 LLM 路由都需要登录
router.use(auth);

// ====== 供应商预设（2026-08-09 官方抓取） ======
// 结构：供应商 -> 接入方式 -> 协议 -> { base_url, models, context_length }
const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    plans: [
      {
        id: 'standard',
        name: '标准 API（按量计费）',
        protocols: {
          openai: {
            base_url: 'https://api.deepseek.com/v1',
            models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
            context_length: 128000,
          },
          anthropic: {
            base_url: 'https://api.deepseek.com/anthropic',
            models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
            context_length: 128000,
          },
        },
      },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    plans: [
      {
        id: 'coding-plan',
        name: 'GLM Coding Plan（订阅套餐）',
        protocols: {
          openai: {
            base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
            models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo'],
            context_length: 1000000,
          },
          anthropic: {
            base_url: 'https://open.bigmodel.cn/api/anthropic',
            models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo'],
            context_length: 1000000,
          },
        },
      },
      {
        id: 'standard',
        name: '标准 API（按量计费）',
        protocols: {
          openai: {
            base_url: 'https://open.bigmodel.cn/api/paas/v4',
            models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo'],
            context_length: 128000,
          },
        },
      },
    ],
  },
  {
    id: 'volcengine',
    name: '火山引擎（方舟）',
    plans: [
      {
        id: 'coding-plan',
        name: 'Coding Plan（编程套餐）',
        protocols: {
          anthropic: {
            base_url: 'https://ark.cn-beijing.volces.com/api/coding',
            models: ['doubao-seed-2.1-turbo', 'doubao-seed-2.0-lite', 'doubao-seed-2.0-mini'],
            context_length: 128000,
          },
        },
      },
      {
        id: 'agent-plan',
        name: 'Agent Plan（全模态套餐）',
        protocols: {
          openai: {
            base_url: 'https://ark.cn-beijing.volces.com/api/plan/v3',
            models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k3', 'kimi-k2.7-code', 'glm-5.2', 'doubao-seed-2.1-turbo', 'doubao-seed-evolving'],
            context_length: 1000000,
          },
          anthropic: {
            base_url: 'https://ark.cn-beijing.volces.com/api/plan',
            models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k3', 'kimi-k2.7-code', 'glm-5.2', 'doubao-seed-2.1-turbo', 'doubao-seed-evolving'],
            context_length: 1000000,
          },
        },
      },
      {
        id: 'standard',
        name: '标准 API（按量计费）',
        protocols: {
          openai: {
            base_url: 'https://ark.cn-beijing.volces.com/api/v3',
            models: ['doubao-seed-2.1-turbo', 'doubao-seed-2.0-lite', 'deepseek-v4-pro', 'kimi-k3'],
            context_length: 128000,
          },
          anthropic: {
            base_url: 'https://ark.cn-beijing.volces.com/api/compatible',
            models: ['doubao-seed-2.1-turbo', 'doubao-seed-2.0-lite', 'deepseek-v4-pro', 'kimi-k3'],
            context_length: 128000,
          },
        },
      },
    ],
  },
  {
    id: 'qwen',
    name: '通义千问（百炼）',
    plans: [
      {
        id: 'coding-plan',
        name: 'Coding Plan（编程套餐）',
        protocols: {
          openai: {
            base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            models: ['qwen3-coder', 'qwen3.7-plus'],
            context_length: 256000,
          },
          anthropic: {
            base_url: 'https://dashscope.aliyuncs.com/apps/anthropic',
            models: ['qwen3-coder', 'qwen3.7-plus'],
            context_length: 256000,
          },
        },
      },
      {
        id: 'standard',
        name: '标准 API（按量计费）',
        protocols: {
          openai: {
            base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3-coder'],
            context_length: 128000,
          },
          anthropic: {
            base_url: 'https://dashscope.aliyuncs.com/apps/anthropic',
            models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3-coder'],
            context_length: 128000,
          },
        },
      },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot（Kimi）',
    plans: [
      {
        id: 'standard',
        name: '标准 API（按量计费）',
        protocols: {
          openai: {
            base_url: 'https://api.moonshot.cn/v1',
            models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
            context_length: 1000000,
          },
        },
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    plans: [
      {
        id: 'standard',
        name: '标准 API',
        protocols: {
          openai: {
            base_url: 'https://api.openai.com/v1',
            models: ['gpt-4o', 'gpt-4o-mini', 'o4-mini', 'gpt-4.1'],
            context_length: 128000,
          },
        },
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    plans: [
      {
        id: 'standard',
        name: '标准 API',
        protocols: {
          anthropic: {
            base_url: 'https://api.anthropic.com',
            models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3.5'],
            context_length: 200000,
          },
        },
      },
    ],
  },
  {
    id: 'custom',
    name: '自定义',
    plans: [
      {
        id: 'custom',
        name: '自定义配置',
        protocols: {
          openai: { base_url: '', models: [], context_length: 64000 },
          anthropic: { base_url: '', models: [], context_length: 64000 },
        },
      },
    ],
  },
];

// API Key 脱敏：显示前3后3
function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 3) + '***' + key.slice(-3);
}

// 供应商预设列表（前端用）
router.get('/presets', (req, res) => {
  res.json(PROVIDER_PRESETS);
});

// ★ 归属隔离（2026-09-01）：llm_configs.user_id —— NULL=全局(管理员配，全平台可用)；非空=用户私有(仅本人可用)
// 实时刷新角色（借鉴 adminOnly，避免 JWT 签发快照过期）
async function isAdmin(userId) {
  const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
  return rows[0]?.role === 'admin';
}

async function loadRow(req, res, id) {
  const { rows } = await db.query('SELECT u.id, u.user_id FROM llm_configs u WHERE u.id = $1 LIMIT 1', [id]);
  const row = rows[0] || null;
  if (!row) { res.status(404).json({ error: '配置不存在' }); return null; }
  const admin = await isAdmin(req.user.id);
  if (!admin && row.user_id !== req.user.id) {
    res.status(403).json({ error: '无权操作他人私有模型配置' });
    return null;
  }
  return row;
}

// 查看配置列表：管理员看全部；普通用户只看「全局 + 自己的私有」（Key 脱敏，带归属）
router.get('/configs', async (req, res) => {
  const admin = await isAdmin(req.user.id);
  const where = admin ? '' : 'WHERE u.user_id IS NULL OR u.user_id = $1';
  const params = admin ? [] : [req.user.id];
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.base_url, u.api_key, u.model, u.api_type, u.is_default, u.context_length, u.max_tokens, u.user_id, u.created_at
     FROM llm_configs u ${where} ORDER BY u.created_at DESC`, params);
  res.json(rows.map(r => ({ ...r, api_key: maskKey(decryptKey(r.api_key)) })));
});

// 当前用户「生效 provider」：login 插件用它决定工作台直连目标（私有默认 > 全局默认）。
// 私有时返回明文 key 供浏览器直连自己的 base_url；全局时标记 gateway=true（走平台网关，不返 key）。
router.get('/configs/effective', async (req, res) => {
  const uid = req.user.id;
  const priv = await db.query('SELECT * FROM llm_configs WHERE user_id = $1 AND is_default LIMIT 1', [uid]);
  if (priv.rows[0]) {
    const c = priv.rows[0];
    return res.json({ scope: 'private', id: c.id, name: c.name, base_url: c.base_url, api_type: c.api_type, model: c.model, models: [c.model], context_length: c.context_length, max_tokens: c.max_tokens, api_key: decryptKey(c.api_key) });
  }
  const g = await db.query('SELECT * FROM llm_configs WHERE user_id IS NULL AND is_default LIMIT 1');
  if (g.rows[0]) {
    const c = g.rows[0];
    return res.json({ scope: 'global', id: c.id, name: c.name, base_url: c.base_url, api_type: c.api_type, model: c.model, models: [c.model] });
  }
  res.json({ scope: 'none' });
});

// 新增/维护配置：管理员建全局（可留口替他人建私有）；普通用户只能建自己的私有模型。
router.post('/configs', async (req, res) => {
  const { name, base_url, api_key, model, api_type, is_default, context_length, max_tokens, user_id } = req.body;
  if (!name || !api_key || !model) {
    return res.status(400).json({ error: 'name, api_key, model 不能为空' });
  }
  const admin = await isAdmin(req.user.id);
  const scopeUserId = admin ? (user_id || null) : req.user.id; // 普通用户强制私有
  const id = uuid();
  try {
    if (is_default) {
      // 默认互斥按范围：全局行只在全局里清零；私有行只在该用户范围里清零
      if (scopeUserId === null) await db.query('UPDATE llm_configs SET is_default = false WHERE user_id IS NULL');
      else await db.query('UPDATE llm_configs SET is_default = false WHERE user_id = $1', [scopeUserId]);
    }
    await db.query(
      'INSERT INTO llm_configs (id, name, base_url, api_key, model, api_type, is_default, context_length, max_tokens, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, name, base_url, encryptKey(api_key), model, api_type || 'openai', is_default || false, context_length || 64000, max_tokens || 16000, scopeUserId]
    );
    res.status(201).json({ id, name, base_url, model, api_type: api_type || 'openai', is_default, context_length: context_length || 64000, max_tokens: max_tokens || 16000, user_id: scopeUserId });
  } catch (err) {
    console.error('保存 LLM 配置失败:', err);
    res.status(500).json({ error: '保存 LLM 配置失败' });
  }
});

router.put('/configs/:id', async (req, res) => {
  const { name, base_url, api_key, model, api_type, is_default, context_length, max_tokens } = req.body;
  const row = await loadRow(req, res, req.params.id);
  if (!row) return;
  if (is_default) {
    // 按被改行的归属范围清零（避免普通用户改到全局范围）
    if (row.user_id === null) await db.query('UPDATE llm_configs SET is_default = false WHERE user_id IS NULL');
    else await db.query('UPDATE llm_configs SET is_default = false WHERE user_id = $1', [row.user_id]);
  }
  const sets = ['name = $2', 'base_url = $3', 'model = $4', 'api_type = $5', 'is_default = $6', 'context_length = $7', 'max_tokens = $8'];
  const params = [req.params.id, name, base_url, model, api_type || 'openai', is_default, context_length || 64000, max_tokens || 16000];
  if (api_key) {
    sets.push('api_key = $9');
    params.push(encryptKey(api_key));
  }
  await db.query(`UPDATE llm_configs SET ${sets.join(', ')} WHERE id = $1`, params);
  res.json({ ok: true });
});

router.delete('/configs/:id', async (req, res) => {
  const row = await loadRow(req, res, req.params.id);
  if (!row) return;
  await db.query('DELETE FROM llm_configs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
