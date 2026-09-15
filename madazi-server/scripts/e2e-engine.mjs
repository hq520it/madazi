// engine 标记端到端验证：DSH 项目发只读消息 → 切 self 再发 → 切回 dsh
// 用法：sudo docker cp e2e-engine.mjs madazi-server:/app/ && sudo docker exec -w /app madazi-server node e2e-engine.mjs
import jwt from 'jsonwebtoken';

const BASE = 'https://<YOUR-DOMAIN>/api';
const PROJECT = 'd990c6c0-5639-41c2-abc4-4ab5dd5eed1c';
const token = jwt.sign(
  { id: '2c2089c6-b811-486a-aae8-9d8821f2cf3b', username: 'admin', role: 'admin' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

async function sendChat(message) {
  const resp = await fetch(`${BASE}/projects/${PROJECT}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  console.log('[chat] HTTP', resp.status);
  if (!resp.ok) { console.log('[chat] body', (await resp.text()).slice(0, 300)); return null; }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let doneEvt = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const ev = JSON.parse(data);
        if (['task_start', 'done', 'error', 'status'].includes(ev.type)) {
          console.log('[event]', JSON.stringify(ev).slice(0, 250));
        }
        if (ev.type === 'done') doneEvt = ev;
        if (ev.type === 'error') { console.log('[chat] ERROR EVENT'); doneEvt = ev; }
      } catch {}
    }
  }
  return doneEvt;
}

async function setMode(mode) {
  const resp = await fetch(`${BASE}/projects/${PROJECT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ai_mode: mode }),
  });
  const body = await resp.text();
  console.log(`[setMode ${mode}] HTTP`, resp.status, body.slice(0, 200));
}

async function main() {
  // 1. dsh 项目（默认）发消息
  const r1 = await sendChat('请列出项目根目录下的文件（只读操作，不要修改任何文件）');
  console.log('RESULT1 conversationId=', r1?.conversationId, 'taskId=', r1?.taskId, 'status=', r1?.status);
  // 2. 切 self 发消息
  await setMode('self');
  const r2 = await sendChat('请列出项目根目录下的文件（只读操作，不要修改任何文件）');
  console.log('RESULT2 conversationId=', r2?.conversationId, 'taskId=', r2?.taskId, 'status=', r2?.status);
  // 3. 切回 dsh
  await setMode('dsh');
  console.log('DONE');
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
