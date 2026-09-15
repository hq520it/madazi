import { getDefaultConfig } from './src/services/llm.js';
import OpenAI from 'openai';

const cfg = await getDefaultConfig();
console.log('config:', cfg.name, '|', cfg.base_url, '| model=', cfg.model);

// 1) openai SDK 报错，打印底层 cause
const client = new OpenAI({ baseURL: cfg.base_url, apiKey: cfg.api_key });
try {
  const stream = await client.chat.completions.create({
    model: cfg.model, messages: [{ role: 'user', content: 'OK' }], max_tokens: 10, stream: true,
  });
  let full = '';
  for await (const c of stream) full += c.choices?.[0]?.delta?.content || '';
  console.log('OPENAI SDK RESULT:', JSON.stringify(full));
} catch (e) {
  console.log('OPENAI SDK ERROR:', e.constructor.name, '|', e.message);
  console.log('  cause:', e.cause?.constructor?.name, '|', e.cause?.message, '|', e.cause?.code);
}

// 2) Node 原生 fetch 直连
const url = cfg.base_url.replace(/\/$/, '') + '/chat/completions';
console.log('\n--- Node 原生 fetch 直连 ---');
try {
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.api_key}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'OK' }], max_tokens: 10 }),
  });
  const text = await resp.text();
  console.log('HTTP', resp.status, '|', (Date.now() - t0) + 'ms');
  console.log('BODY:', text.slice(0, 300));
} catch (e) {
  console.log('FETCH ERROR:', e.constructor.name, '|', e.message, '| cause:', e.cause?.message);
}
