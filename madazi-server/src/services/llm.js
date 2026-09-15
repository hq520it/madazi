import OpenAI from 'openai';
import { db } from '../db/init.js';
import { v4 as uuid } from 'uuid';
import { logUsage, checkQuota, QuotaExceededError, reserveQuota, releaseReservation } from './usage.js';
import { decryptKey } from './keycrypto.js';

export async function getDefaultConfig() {
  // ★ 归属隔离：服务端自研调用只认全局默认（user_id IS NULL），防普通用户私有默认污染全局
  const { rows } = await db.query('SELECT * FROM llm_configs WHERE user_id IS NULL AND is_default = true LIMIT 1');
  const cfg = rows[0] || null;
  if (cfg?.api_key) cfg.api_key = decryptKey(cfg.api_key);
  return cfg;
}

export async function getConfigById(id) {
  const { rows } = await db.query('SELECT * FROM llm_configs WHERE id = $1 LIMIT 1', [id]);
  const cfg = rows[0] || null;
  if (cfg?.api_key) cfg.api_key = decryptKey(cfg.api_key);
  return cfg;
}

// ====== Anthropic 格式转换层 ======

/**
 * OpenAI messages -> Anthropic messages
 * 
 * 处理三种情况：
 * 1. system 消息 -> 提取到顶层 system 参数
 * 2. assistant + tool_calls -> content 数组（text + tool_use blocks）
 * 3. tool 结果消息 -> 合并到 user 消息的 tool_result content blocks
 */
function toAnthropicMessages(messages) {
  let system = '';
  const msg = [];
  const pendingToolResults = []; // 累积连续的 tool 结果

  function flushToolResults() {
    if (pendingToolResults.length > 0) {
      msg.push({
        role: 'user',
        content: pendingToolResults.map(r => ({
          type: 'tool_result',
          tool_use_id: r.tool_call_id,
          content: r.content,
        })),
      });
      pendingToolResults.length = 0;
    }
  }

  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n' : '') + m.content;
      continue;
    }

    // tool 结果消息 -> 累积，等遇到非 tool 消息时 flush
    if (m.role === 'tool') {
      pendingToolResults.push({ tool_call_id: m.tool_call_id, content: m.content });
      continue;
    }

    // 非 tool 消息前先 flush 累积的 tool 结果
    flushToolResults();

    if (m.role === 'assistant') {
      // 有 tool_calls 的 assistant 消息 -> content 数组
      if (m.tool_calls && m.tool_calls.length > 0) {
        const content = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const tc of m.tool_calls) {
          let input = {};
          try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        msg.push({ role: 'assistant', content });
      } else {
        // 纯文本 assistant 消息
        msg.push({ role: 'assistant', content: m.content || '' });
      }
    } else {
      // user 消息
      msg.push({ role: 'user', content: m.content });
    }
  }

  // 最后 flush
  flushToolResults();

  return { system, messages: msg };
}

/**
 * OpenAI tools 格式 -> Anthropic tools 格式
 * OpenAI: { type: 'function', function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema }
 */
function toAnthropicTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    name: t.function?.name || t.name,
    description: t.function?.description || t.description,
    input_schema: t.function?.parameters || t.input_schema,
  }));
}

/**
 * ★ P2-3：OpenAI tool_choice -> Anthropic tool_choice 格式转换
 * OpenAI: 'auto' | 'none' | 'required' | { type:'function', function:{ name } }
 * Anthropic: { type:'auto' } | { type:'any' } | { type:'tool', name }
 */
function toAnthropicToolChoice(tc) {
  if (!tc) return undefined;
  if (tc === 'auto') return { type: 'auto' };
  if (tc === 'none') return { type: 'auto' }; // Anthropic 无 none，靠不传 tools 实现
  if (tc === 'required') return { type: 'any' };
  if (typeof tc === 'object' && tc.function?.name) return { type: 'tool', name: tc.function.name };
  return undefined;
}

/**
 * Anthropic tool_use -> OpenAI tool_calls 格式
 * Anthropic: { id, name, input }
 * OpenAI: { id, type: 'function', function: { name, arguments } }
 */
function fromAnthropicToolUse(block) {
  return {
    id: block.id,
    type: 'function',
    function: {
      name: block.name,
      arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
    },
  };
}

/**
 * 创建 Anthropic 客户端（直接用 fetch，不依赖 @anthropic-ai/sdk）
 */
function createAnthropicClient(config) {
  const baseURL = config.base_url.replace(/\/$/, '');
  const apiKey = config.api_key;

  // 火山引擎方舟 + 智谱用 Bearer 认证，标准 Anthropic 用 x-api-key
  const isVolcengine = baseURL.includes('volces.com');
  const isZhipu = baseURL.includes('bigmodel.cn');
  const useBearer = isVolcengine || isZhipu;
  const authHeader = useBearer
    ? { 'Authorization': `Bearer ${apiKey}` }
    : { 'x-api-key': apiKey };

  async function* streamMessages({ model, system, messages, max_tokens, temperature, tools, tool_choice, signal }) {
    const body = {
      model,
      max_tokens,
      messages,
      stream: true,
    };
    if (system) body.system = system;
    if (temperature !== undefined) body.temperature = temperature;
    if (tools) body.tools = tools;
    // ★ P2-3 修复：Anthropic 分支此前忽略 tool_choice
    if (tool_choice) body.tool_choice = tool_choice;

    // ★ P2-2 修复：支持外部 AbortSignal。原实现无 signal，LLM 提供方挂起时
    // fetch 永不返回，TASK_TIMEOUT 无法中断（任务卡死后只能靠容器回收）。
    // signal 触发时 fetch 抛 AbortError，由调用方 catch 转任务失败。
    const resp = await fetch(`${baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...authHeader,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic API error ${resp.status}: ${text}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data) continue;
          try {
            const evt = JSON.parse(data);
            // ★ P2-3 修复：SSE error 事件此前被静默忽略，流正常结束返回空串，
            // 调用方无法区分「模型输出为空」和「API 报错」。现在显式抛出。
            if (evt.type === 'error') {
              throw new Error(`Anthropic API stream error: ${evt.error?.message || JSON.stringify(evt.error)}`);
            }
            yield evt;
          } catch (e) {
            if (String(e.message).startsWith('Anthropic API stream error')) throw e;
            // skip non-JSON
          }
        }
      }
    }
  }

  return { streamMessages };
}

// ====== 统一 createClient ======

export async function createClient(config) {
  const apiType = config.api_type || 'openai';
  if (apiType === 'anthropic') {
    return { type: 'anthropic', client: createAnthropicClient(config) };
  }
  return { type: 'openai', client: new OpenAI({ baseURL: config.base_url, apiKey: config.api_key, maxRetries: 6, timeout: 300000 }) };
}

/**
 * 解析 max_tokens：代码传入 > 配置表 > 默认 16000
 */
function resolveMaxTokens(options, config) {
  return options.max_tokens ?? config.max_tokens ?? 16000;
}

// ====== chat（非流式，内部走流式） ======

export async function chat(messages, options = {}) {
  const quota = await checkQuota(options.userId);
  if (!quota.allowed) throw new QuotaExceededError(quota.used, quota.limit);
  const config = options.config || await getDefaultConfig();
  if (!config) throw new Error('No LLM config. Please configure API key in Settings.');

  const maxTokens = resolveMaxTokens(options, config);
  // ★ P2 B9：并发预留（预扣估算，结束释放）
  const estimate = Math.ceil(JSON.stringify(messages).length / 4) + maxTokens;
  reserveQuota(options.userId, estimate);
  try {
    const { type, client } = await createClient(config);

    if (type === 'anthropic') {
      const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);
      let full = '';
      for await (const event of client.streamMessages({
        model: config.model,
        system,
        messages: anthropicMsgs,
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.3,
        signal: options.signal || null, // ★ P2-2
      })) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          full += event.delta.text;
        }
      }
    await logUsage({ userId: options.userId, projectId: options.projectId, configId: config.id, model: config.model, promptText: JSON.stringify(messages), completionText: full });
      return full;
    }

    // OpenAI 分支（原逻辑）
    const stream = await client.chat.completions.create({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: maxTokens,
      stream: true,
    }, { signal: options.signal || undefined }); // ★ P2-2：外部中断

    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta || {};
      if (delta.content) {
        full += delta.content;
      }
    }

    // 兜底：极端情况下流式 content 为空，回退非流式拿 reasoning_content
    if (!full) {
      const res = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: maxTokens,
      });
      const msg = res.choices[0]?.message;
      full = msg?.content ?? msg?.reasoning_content ?? '';
    }

    await logUsage({ userId: options.userId, projectId: options.projectId, configId: config.id, model: config.model, promptText: JSON.stringify(messages), completionText: full });
    return full;
  } finally {
    releaseReservation(options.userId, estimate);
  }
}

// ====== chatStream（纯文本流式） ======

export async function chatStream(messages, onChunk, options = {}) {
  const quota = await checkQuota(options.userId);
  if (!quota.allowed) throw new QuotaExceededError(quota.used, quota.limit);
  const config = options.config || await getDefaultConfig();
  if (!config) throw new Error('No LLM config. Please configure API key in Settings.');

  const maxTokens = resolveMaxTokens(options, config);
  // ★ P2 B9：并发预留（预扣估算，logUsage 后释放；异常路径由 TTL 兜底）
  reserveQuota(options.userId, Math.ceil(JSON.stringify(messages).length / 4) + maxTokens);
  const { type, client } = await createClient(config);
  const streamReasoning = options.streamReasoning !== false; // 默认 true，传 false 则不 emit reasoning
  // ★ 截断续写（默认关闭，不影响其他调用方；开启后遇到 finish_reason=length / stop_reason=max_tokens 自动续写）
  const continueOnTruncation = options.continueOnTruncation === true;
  const maxContinueRounds = options.maxContinueRounds ?? 3; // 最多续写轮数，防止无限循环

  let full = '';
  let currentMessages = messages;
  let round = 0;

  while (true) {
    // ---- 单轮生成（返回本轮文本 + 是否被截断） ----
    let roundText = '';
    let truncated = false;

    if (type === 'anthropic') {
      const { system, messages: anthropicMsgs } = toAnthropicMessages(currentMessages);
      let stopReason = null;
      for await (const event of client.streamMessages({
        model: config.model,
        system,
        messages: anthropicMsgs,
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.3,
        signal: options.signal || null, // ★ P2-2
      })) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          roundText += event.delta.text;
          onChunk(event.delta.text);
        } else if (event.type === 'message_stop') {
          stopReason = event.stop_reason ?? null;
        }
      }
      truncated = stopReason === 'max_tokens';
    } else {
      // OpenAI 分支（原逻辑）
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: currentMessages,
        temperature: options.temperature ?? 0.3,
        max_tokens: maxTokens,
        stream: true,
      }, { signal: options.signal || undefined }); // ★ P2-2

      let reasoningFull = '';
      let reasoningEmitted = false; // ★ 是否已把 reasoning 当正文实时 emit
      let reasoningOpen = false;
      let finishReason = null;

      for await (const chunk of stream) {
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        const delta = chunk.choices[0]?.delta || {};

        if (delta.reasoning_content) {
          reasoningFull += delta.reasoning_content;

          if (streamReasoning) {
            // 正常 reasoning 展示（带 thinking 标签）
            if (!reasoningOpen) {
              onChunk('<thinking>\n' + delta.reasoning_content);
              reasoningOpen = true;
            } else {
              onChunk(delta.reasoning_content);
            }
          } else if (!roundText) {
            // ★ content 还没出现过 -> 把 reasoning 当正文实时 emit（不包 thinking 标签）
            if (!reasoningEmitted) reasoningEmitted = true;
            onChunk(delta.reasoning_content);
          }
        }

        if (reasoningOpen && delta.content) {
          onChunk('\n</thinking>\n');
          reasoningOpen = false;
        }

        if (delta.content) {
          roundText += delta.content;
          onChunk(delta.content);
        }
      }

      if (reasoningOpen) {
        onChunk('\n</thinking>\n');
      }

      // ★ 兜底：content 为空，用 reasoningFull
      if (!roundText && reasoningFull) {
        roundText = reasoningFull;
        // 如果 streamReasoning=false 且已经实时 emit 过了，不重复 emit
        // 如果 streamReasoning=true，reasoning 已经包在 thinking 标签里 emit 过了，也不重复
      }

      truncated = finishReason === 'length';
    }

    full += roundText;

    // ★ 截断续写：被 max_tokens 截断且本轮有实际输出，追加"请继续"后重试
    if (continueOnTruncation && truncated && roundText && round < maxContinueRounds) {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: roundText },
        { role: 'user', content: '（上一条因达到 max_tokens 上限被截断）请直接接着输出剩余内容，不要重复已生成的部分。' },
      ];
      round++;
      continue;
    }

    break;
  }

  await logUsage({ userId: options.userId, projectId: options.projectId, configId: config.id, model: config.model, promptText: JSON.stringify(messages), completionText: full });
  releaseReservation(options.userId, Math.ceil(JSON.stringify(messages).length / 4) + maxTokens);
  return full;
}

// ====== chatStreamWithTools（带工具调用的流式对话） ======

export async function chatStreamWithTools(messages, onChunk, options = {}) {
  const quota = await checkQuota(options.userId);
  if (!quota.allowed) throw new QuotaExceededError(quota.used, quota.limit);
  const config = options.config || await getDefaultConfig();
  if (!config) throw new Error('No LLM config. Please configure API key in Settings.');

  const maxTokens = resolveMaxTokens(options, config);
  // ★ P2 B9：并发预留（预扣估算，return 前释放；异常路径由 TTL 兜底）
  reserveQuota(options.userId, Math.ceil(JSON.stringify(messages).length / 4) + maxTokens);
  const { type, client } = await createClient(config);

  // ====== Anthropic 分支 ======
  if (type === 'anthropic') {
    const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);
    const anthropicTools = toAnthropicTools(options.tools);

    let full = '';
    const toolCalls = [];
    let currentToolUseId = null;
    let currentToolUseName = '';
    let currentToolInput = '';

    for await (const event of client.streamMessages({
      model: config.model,
      system,
      messages: anthropicMsgs,
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0.3,
      tools: anthropicTools,
      tool_choice: toAnthropicToolChoice(options.tool_choice), // ★ P2-3
      signal: options.signal || null, // ★ P2-2
    })) {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            currentToolUseId = event.content_block.id;
            currentToolUseName = event.content_block.name;
            currentToolInput = '';
          }
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            full += event.delta.text;
            onChunk(event.delta.text);
          } else if (event.delta?.type === 'input_json_delta') {
            currentToolInput += event.delta.partial_json;
          }
          break;

        case 'content_block_stop':
          if (currentToolUseId) {
            toolCalls.push({
              id: currentToolUseId,
              type: 'function',
              function: {
                name: currentToolUseName,
                arguments: currentToolInput || '{}',
              },
            });
            currentToolUseId = null;
            currentToolUseName = '';
            currentToolInput = '';
          }
          break;
      }
    }

  await logUsage({ userId: options.userId, projectId: options.projectId, configId: config.id, model: config.model, promptText: JSON.stringify(messages), completionText: full });
    releaseReservation(options.userId, Math.ceil(JSON.stringify(messages).length / 4) + maxTokens);
    return { content: full, toolCalls };
  }

  // ====== OpenAI 分支（原逻辑） ======
  const stream = await client.chat.completions.create({
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: maxTokens,
    tools: options.tools,
    tool_choice: options.tool_choice || 'auto',
    stream: true,
  }, { signal: options.signal || undefined }); // ★ P2-2

  let full = '';
  let reasoningOpen = false;
  const toolCallsMap = new Map();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta || {};

    if (delta.reasoning_content) {
      if (!reasoningOpen) {
        onChunk('<thinking>\n' + delta.reasoning_content);
        reasoningOpen = true;
      } else {
        onChunk(delta.reasoning_content);
      }
    }
    if (reasoningOpen && delta.content) {
      onChunk('\n</thinking>\n');
      reasoningOpen = false;
    }

    if (delta.content) {
      full += delta.content;
      onChunk(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, {
            id: tc.id || '',
            type: 'function',
            function: { name: '', arguments: '' },
          });
        }
        const entry = toolCallsMap.get(idx);
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.function.name += tc.function.name;
        if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
      }
    }
  }

  if (reasoningOpen) {
    onChunk('\n</thinking>\n');
  }

  const toolCalls = [...toolCallsMap.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  await logUsage({ userId: options.userId, projectId: options.projectId, configId: config.id, model: config.model, promptText: JSON.stringify(messages), completionText: full });
  releaseReservation(options.userId, Math.ceil(JSON.stringify(messages).length / 4) + maxTokens);
  return { content: full, toolCalls };
}
