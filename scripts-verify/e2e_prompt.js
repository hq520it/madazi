// E2E 验证：绑定模型路由 → session.prompt 让 AI 改首页标题 → 轮询完成
const BASE = 'https://<YOUR-DOMAIN>';
const TOKEN = require('fs').readFileSync('/tmp/e2e_token', 'utf8').trim();
const SID = process.argv[2];
const ROUTE = 'madazi-u-c360e27e868e42b5977066e892da14e78';
const MODEL = 'deepseek-v4-flash';

async function rpc(method, payload) {
  const r = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-' + Math.random().toString(36).slice(2, 8), method, payload }),
  });
  return r.json();
}

(async () => {
  // 1) 绑定自己的路由
  const sel = await rpc('session.selectModel', { sessionId: SID, provider: ROUTE, model: MODEL });
  console.log('selectModel:', JSON.stringify(sel.result?.ok ? 'ok' : sel.result));

  // 2) prompt：改 vue 首页标题（mode=queue + content blocks）
  const prompt = await rpc('session.prompt', {
    sessionId: SID,
    mode: 'queue',
    content: [{ type: 'text', text: '请把前端首页的标题文案改成「E2E验证-改码成功」。项目是 vue-node 模板，前端代码在 frontend/ 目录。找到首页组件（App.vue 或 views 下的首页），把页面主标题改为「E2E验证-改码成功」，不要做其他任何改动。完成后简要说明你改了哪个文件。' }],
  });
  console.log('prompt:', JSON.stringify(prompt.result?.ok ? 'ok' : prompt.result));

  // 3) 轮询 session 状态直到不 running
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await rpc('session.list', {});
    const items = st.result?.value?.items || [];
    const me = items.find((x) => x.sessionId === SID);
    if (!me) { console.log(`[${i}] session 不在列表（可能已归档），继续等`); continue; }
    const running = me.running;
    const title = (me.projections && me.projections.values && me.projections.values.title) || null;
    const stats = (me.projections && me.projections.values && me.projections.values.sessionStats) || {};
    console.log(`[${i * 5}s] running=${running} title=${title} turns=${stats.turns} steps=${stats.steps}`);
    if (!running && (stats.turns || 0) > 0) { console.log('会话已完成'); return; }
  }
  console.log('超时未完成');
})();
