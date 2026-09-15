// DSH 提交人验证：发一条真实改代码任务（创建 hello.txt），随后查 git log author
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
        if (['task_start', 'done', 'error'].includes(ev.type)) {
          console.log('[event]', JSON.stringify(ev).slice(0, 250));
        }
        if (ev.type === 'done') doneEvt = ev;
      } catch {}
    }
  }
  return doneEvt;
}

const r = await sendChat('创建一个 hello.txt 文件，内容为 dsh-committer-test，创建完成后提交到 git（这是测试提交人区分的任务）');
console.log('RESULT conversationId=', r?.conversationId, 'taskId=', r?.taskId, 'commitHash=', r?.commitHash, 'files=', JSON.stringify(r?.modifiedFiles));
