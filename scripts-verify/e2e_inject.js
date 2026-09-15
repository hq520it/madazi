// E2E 验证：模拟 login 插件的 BYOK 注入（settings.mutate + credentials.set）
const BASE = 'https://<YOUR-DOMAIN>';
const TOKEN = require('fs').readFileSync('/tmp/e2e_token', 'utf8').trim();
const KEYINFO = JSON.parse(require('fs').readFileSync('/tmp/e2e_key.json', 'utf8'));
const UID = 'c360e27e868e42b5977066e892da14e78'; // e2etest0823 去 - 后
const ROUTE = 'madazi-u-' + UID;
const KEY_REF = 'MADAZI_KEY_' + UID;

async function rpc(method, payload) {
  const r = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-' + Math.random().toString(36).slice(2, 8), method, payload }),
  });
  const j = await r.json();
  return j;
}

(async () => {
  // 1) describe 拿 llm-pi-ai revision
  const desc = await rpc('settings.describe', {});
  const nsList = desc.result?.value?.namespaces || [];
  const ns = nsList.find((x) => x.ns === 'llm-pi-ai');
  if (!ns) { console.log('FAIL: llm-pi-ai ns 不存在'); return; }
  console.log('llm-pi-ai revision:', ns.revision);

  // 2) 写自己的 provider 路由
  const models = KEYINFO.models.map((m) => ({ id: m, name: m }));
  const profile = {
    apiKeyEnv: KEY_REF,
    displayName: 'Madazi · e2etest0823',
    api: 'openai-completions',
    baseURL: BASE + '/llm/v1',
    models,
  };
  const mut = await rpc('settings.mutate', {
    ns: 'llm-pi-ai',
    ops: [{ op: 'set', path: ['providers', ROUTE], value: profile }],
    expectedRevision: ns.revision,
  });
  console.log('settings.mutate:', JSON.stringify(mut.result?.ok ? 'ok' : mut.result));

  // 3) credentials.set 存 key
  const cred = await rpc('credentials.set', { ref: KEY_REF, value: KEYINFO.key });
  console.log('credentials.set:', JSON.stringify(cred.result?.ok ? 'ok' : cred.result));

  // 4) 复核：describe 确认路由已写入
  const desc2 = await rpc('settings.describe', {});
  const ns2 = (desc2.result?.value?.namespaces || []).find((x) => x.ns === 'llm-pi-ai');
  const route = ns2?.value?.providers?.[ROUTE];
  console.log('路由已写入:', !!route, '| baseURL:', route?.baseURL, '| models:', route?.models?.length);
})();
