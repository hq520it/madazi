// 端到端验证：项目设置 AI 模式（ai_mode）+ 普通对话强制走 DSH
// 容器内执行：sudo docker cp e2e-aimode.mjs madazi-server:/app/ && sudo docker exec -w /app madazi-server node e2e-aimode.mjs
import jwt from 'jsonwebtoken';

const BASE = 'http://localhost:3456';
const ADMIN_ID = '2c2089c6-b811-486a-aae8-9d8821f2cf3b';
const PID = 'd990c6c0-5639-41c2-abc4-4ab5dd5eed1c';
const secret = process.env.JWT_SECRET || 'madazi-dev-secret-change-in-prod';
const token = jwt.sign({ id: ADMIN_ID, username: 'admin', role: 'user' }, secret, { expiresIn: '1h' });

const run = async (label, url, opts = {}) => {
  const res = await fetch(BASE + url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  console.log(`\n=== ${label} → HTTP ${res.status}`);
  console.log(text.slice(0, 600));
  return { status: res.status, text };
};

// 1. GET 项目（预启动 dsh 容器 + 鉴权验证）
await run('GET project (prewarm)', `/api/projects/${PID}`);

// 2. PUT ai_mode=self
const r2 = await run('PUT ai_mode=self', `/api/projects/${PID}`, {
  method: 'PUT', body: JSON.stringify({ ai_mode: 'self' }),
});
console.log('self 生效:', r2.text.includes('"ai_mode":"self"'));

// 3. PUT ai_mode=dsh（还原）
await run('PUT ai_mode=dsh', `/api/projects/${PID}`, {
  method: 'PUT', body: JSON.stringify({ ai_mode: 'dsh' }),
});

// 4. 非法值校验
await run('PUT ai_mode=bad (expect 400)', `/api/projects/${PID}`, {
  method: 'PUT', body: JSON.stringify({ ai_mode: 'hack' }),
});

// 5. 普通对话（不带 mode）→ 应强制走 DSH：SSE 输出 task 事件 + 容器内 worktree
console.log('\n=== 普通对话（无 mode，预期走 DSH）===');
try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  const res = await fetch(BASE + `/api/projects/${PID}/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '请查看项目根目录，列出有哪些文件，一句话总结' }),
    signal: ctrl.signal,
  });
  clearTimeout(t);
  console.log('SSE HTTP', res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done = false;
  let taskId = null;
  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) {
      buf += dec.decode(value, { stream: true });
      // 捕获关键事件
      for (const line of buf.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'task_created' || evt.type === 'task') taskId = evt.taskId || evt.task?.id || taskId;
            if (evt.type === 'done' || evt.type === 'error' || evt.type === 'task_completed') {
              console.log('终结事件:', evt.type, evt.error || evt.summary || '');
            }
          } catch {}
        }
      }
    }
  }
  console.log('SSE 流结束, taskId =', taskId);
  console.log('原始流前 300 字:', buf.slice(0, 300).replace(/\n/g, '⏎'));
} catch (e) {
  console.log('SSE 异常（60s 超时也算正常，任务在后台继续）:', e.message);
}
console.log('\nE2E AIMODE DONE');
