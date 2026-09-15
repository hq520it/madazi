// ACP 诊断：打印 exe 全部 stdout 消息（事件+响应），60s 超时定位卡点
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { getDefaultConfig } from '/app/src/services/llm.js';
import { decryptKey } from '/app/src/services/keycrypto.js';

const cfg = await getDefaultConfig();
const key = cfg.api_key?.startsWith('enc:') ? decryptKey(cfg.api_key) : cfg.api_key;
console.log('[diag] base=' + cfg.base_url + ' model=' + cfg.model + ' keyLen=' + (key?.length ?? 0));

const args = [
  'run', '-i', '--rm', '--name', 'madazi-acp-diag',
  '--network', 'madazi-preview-net',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--memory', '2g', '--cpus', '1', '--pids-limit', '100',
  '-v', '/home/ubuntu/madazi-preview-projects:/data',
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
let msgCount = 0;
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    msgCount++;
    let tag = 'MSG';
    let m = null;
    try {
      m = JSON.parse(line);
      tag = m.method ? 'EVENT(' + m.method + ')' : (m.id ? 'RESP(id=' + m.id + ')' : 'MSG');
      if (m.method === 'notifications/update') {
        const u = m.params?.update;
        if (u?.sessionUpdate) console.log('  [event] ' + u.sessionUpdate);
      }
    } catch { tag = 'RAW'; }
    console.log('[' + tag + '] ' + (line.length > 400 ? line.slice(0, 400) + '…' : line));
    if (m?.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[exe-stderr] ' + d));
child.on('exit', (c) => { console.log('[diag] exit code=' + c + ' totalMsg=' + msgCount); process.exit(0); });
function req(method, params) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout 60s')); }, 60_000);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

try {
  const init = await req('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'diag', version: '1.0.0' } });
  console.log('[diag] ① initialize OK');
  fs.mkdirSync('/data/smoke-test', { recursive: true });
  const sess = await req('session/new', { cwd: '/data/smoke-test', mcpServers: [], modelPreferences: {} });
  console.log('[diag] ② session/new OK sid=' + sess.result?.sessionId);
  const p1 = await req('session/prompt', {
    sessionId: sess.result?.sessionId,
    prompt: [{ type: 'text', text: '只运行 bash 命令 pwd 并输出结果' }],
  });
  console.log('[diag] ③ prompt OK stopReason=' + p1.result?.stopReason);
  const blocks = p1.result?.content ?? [];
  console.log('[diag] content=' + JSON.stringify(blocks).slice(0, 500));
} catch (e) {
  console.error('[diag] FAIL: ' + e.message);
} finally {
  try { child.kill(); } catch { /* ignore */ }
  process.exit(0);
}
