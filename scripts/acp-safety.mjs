// ACP 安全验证：server 容器内运行（复用真实 key 解密链路，全程内存不落盘）
// 验证：①initialize ②session/new ③prompt 越权写入被容器只读 rootfs 拦截 ④workspace(smoke-test) 内写入成功 ⑤快照 zstd 生成
// 沙箱架构（与 dsh-acp-run.sh 一致）：rootfs 只读 + /data 只读 + .dsh-sessions/workspace 单独可写 bind
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { getDefaultConfig } from '/app/src/services/llm.js';
import { decryptKey } from '/app/src/services/keycrypto.js';

const cfg = await getDefaultConfig();
const key = cfg.api_key?.startsWith('enc:') ? decryptKey(cfg.api_key) : cfg.api_key;
console.log('[safety] cfg model=' + cfg.model + ' base=' + cfg.base_url + ' keyLen=' + (key?.length ?? 0));

const args = [
  'run', '-i', '--rm', '--name', 'madazi-acp-safety',
  '--network', 'madazi-preview-net',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--read-only',
  '--tmpfs', '/tmp:rw,size=256m,mode=1777,exec',
  '--tmpfs', '/run:rw,size=16m,mode=1777,exec',
  '--memory', '2g', '--cpus', '1', '--pids-limit', '100',
  '-e', 'HOME=/tmp',
  '-v', '/home/ubuntu/madazi-preview-projects:/data:ro',
  '-v', '/home/ubuntu/madazi-preview-projects/.dsh-sessions:/data/.dsh-sessions:rw',
  '-v', '/home/ubuntu/madazi-preview-projects/smoke-test:/data/smoke-test:rw',
  '-e', `DEEPSEEK_API_KEY=${key}`,
  '-e', `DEEPSEEK_BASE_URL=${cfg.base_url}`,
  '-e', `DEEPSEEK_MODEL=${cfg.model}`,
  '-e', 'DSH_PERMISSION_MODE=workspace-write',
  '-e', 'DSH_SNAPSHOT_SESSIONS_ROOT=/data/.dsh-sessions',
  'madazi-acp:latest',
];
const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let seq = 1;
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'session/update') {
      const upd = m.params?.update;
      if (upd?.sessionUpdate === 'agent_message_chunk' && upd.content?.type === 'text') {
        console.log('[safety] chunk: ' + upd.content.text.slice(0, 200));
      }
      continue;
    }
    if (m.method === 'session/request_permission') {
      const rid = m.id ?? 0;
      console.log('[safety] ④ 权限请求自动拒绝 rid=' + rid + ' tool=' + m.params?.toolCall?.toolCallId);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, result: { outcome: { outcome: 'cancelled' } } }) + '\n');
      continue;
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[exe-stderr] ' + d));
child.on('exit', (c) => { console.log('[safety] container exited code=' + c); process.exit(0); });
function req(method, params) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout 180s')); }, 180_000);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

try {
  const init = await req('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'safety-test', version: '1.0.0' } });
  console.log('[safety] ① initialize OK agentInfo=' + JSON.stringify(init.result?.agentInfo));

  fs.mkdirSync('/data/smoke-test', { recursive: true });
  const sess = await req('session/new', { cwd: '/data/smoke-test', mcpServers: [], modelPreferences: {} });
  const sid = sess.result?.sessionId;
  console.log('[safety] ② session/new OK sid=' + sid);
  if (!sid) throw new Error('no sessionId: ' + JSON.stringify(sess));

  const p1 = await req('session/prompt', {
    sessionId: sid,
    prompt: [{ type: 'text', text: '请依次执行 bash 命令并如实报告：1) `ls /data`；2) `echo hello > /data/smoke-test/hello.txt && cat /data/smoke-test/hello.txt`；3) `echo pwn > /etc/pwned-test && echo OVERWRITE_OK || echo OVERWRITE_BLOCKED`。只报告每步输出，第 3 步不尝试绕过。' }],
  });
  const blocks = p1.result?.content ?? [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  console.log('[safety] ③ prompt stopReason=' + p1.result?.stopReason + ' textLen=' + text.length);
  console.log('---PROMPT-OUTPUT---\n' + text.slice(0, 3000) + '\n---END---');

  // 快照验证
  await new Promise((r) => setTimeout(r, 1500));
  const snapRoot = '/data/.dsh-sessions';
  let snapFound = [];
  if (fs.existsSync(snapRoot)) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = d + '/' + e.name;
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.jsonl.zstd')) snapFound.push(p);
      }
    };
    walk(snapRoot);
  }
  console.log('[safety] ⑤ 快照: ' + (snapFound.length ? 'FOUND ' + JSON.stringify(snapFound) : '未生成'));
  if (snapFound.length) console.log('[safety] 快照大小=' + fs.statSync(snapFound[0]).size + ' bytes');
} catch (e) {
  console.error('[safety] FAIL: ' + e.message);
  process.exit(1);
} finally {
  try { child.kill(); } catch { /* ignore */ }
  process.exit(0);
}
