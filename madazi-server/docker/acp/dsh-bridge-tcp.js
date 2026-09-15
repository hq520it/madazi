#!/usr/bin/env node
/**
 * dsh-bridge-tcp.js - dsh Pod 内 TCP-stdio 桥（常驻，监听 7001）+ ★ 旁路直写（P1.5）
 *
 * 职责：
 * 1. 透传：client（server Pod）<-> dsh-agent stdio（newline-delimited JSON-RPC）——照旧
 * 2. ★ 旁路：解析 agent stdout 的 session.event，按 DSH_TASK_ID 直写 Redis Stream（续 seq），
 *    任务完成（turn/end）时直落 DB（conversation_messages）——server 重启生成不断
 * 3. ★ 断开语义：socket 断开不再无脑杀 agent：
 *      - 任务未完成（无 turn/end、无 shutdown）→ 不杀（server 崩溃场景，生成继续，旁路持续落盘）
 *      - 任务已完成（turn/end）或收到取消（shutdown 请求行）→ 杀 agent 进程回收
 * 4. 每连接一个 agent 进程（一任务一进程一 session——平台并发语义）
 *
 * 事件映射（SDK session.event）：
 *   assistant/chunk (text-delta)      → XADD type=chunk
 *   tool/call、tool/result、todo/write → XADD type=tool_event
 *   turn/end: completed/max-tokens    → XADD stream_end + DB completed
 *             error                   → XADD stream_error + DB failed
 *             aborted                 → XADD stream_end(cancelled) + DB cancelled
 *   seq 从流尾续（XREVRANGE 查最后一条，防与重启前 server 写入的 seq 冲突）
 *
 * 依赖：ioredis + pg（镜像构建时装入，npmmirror 源）
 * 握手 env 新增：DSH_AI_MESSAGE_ID（可选——落库用；无则只写 Redis 不落库）
 */
const net = require('net');
const { spawn } = require('child_process');

// ★ npm 形态（2026-08-19）：bridge 在 /opt/dsh，运行时依赖（ioredis/pg）装在 /app/node_modules（PVC profile）。
//   require 默认只向上找 /opt/dsh 的 node_modules，这里把 /app/node_modules 注入解析链，旁路（Redis/DB）才能加载。
for (const p of ['/app/node_modules']) {
  if (!module.paths.includes(p)) module.paths.push(p);
}

const PORT = parseInt(process.env.DSH_TCP_PORT || '7001', 10);
const DSH_EXE = process.env.DSH_EXE || '/usr/local/bin/dsh-agent';
const DEFAULT_ARGS = ['/app/cordis.yml'];

// ============ 旁路客户端（ioredis + pg，失败降级为纯透传） ============
let redis = null;
let pgPool = null;
let redisReady = false;
const REDIS_URL = process.env.REDIS_URL || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

async function initClients() {
  if (REDIS_URL) {
    try {
      const Redis = require('ioredis');
      redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, retryStrategy: null });
      await redis.connect();
      redisReady = true;
      process.stderr.write('[dsh-bridge-tcp] redis connected (bypass on)\n');
    } catch (e) {
      process.stderr.write(`[dsh-bridge-tcp] redis init failed (bypass off): ${e.message}\n`);
      try { redis && redis.disconnect(); } catch {}
      redis = null;
    }
  }
  if (DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pgPool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
      await pgPool.query('SELECT 1');
      process.stderr.write('[dsh-bridge-tcp] pg connected (DB finalize on)\n');
    } catch (e) {
      process.stderr.write(`[dsh-bridge-tcp] pg init failed (DB finalize off): ${e.message}\n`);
      try { pgPool && pgPool.end(); } catch {}
      pgPool = null;
    }
  }
}

const server = net.createServer((socket) => {
  socket.setNoDelay(true);
  let child = null;
  let handshakeDone = false;
  let buf = '';
  let clientBuf = '';   // client→agent 行缓冲（检测 shutdown 取消标记）
  let agentBuf = '';    // agent→client 行缓冲（旁路解析）
  let taskId = '';
  let aiMessageId = '';
  let seq = 0;
  let content = '';               // 累积文本（落库用）
  let doneFlag = false;           // turn/end 已处理（任务完成）
  let cancelFlag = false;         // 收到 shutdown 请求（取消）
  let finalizing = false;         // 终态处理中（防重复）
  const toolCallMap = new Map();  // callId -> tool name

  const log = (m) => process.stderr.write(`[dsh-bridge-tcp] ${m}\n`);

  const killChild = () => {
    if (child && child.exitCode === null) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    child = null;
  };

  // ============ 旁路：XADD（防双写由 server 侧 _skipRedis 保证） ============
  async function xadd(payload) {
    if (!redisReady || !taskId) return;
    try {
      await redis.xadd(`stream:task:${taskId}`, '*', 'p', JSON.stringify(payload));
      redis.pexpire(`stream:task:${taskId}`, 3600_000).catch(() => {});
    } catch (e) {
      log(`xadd failed: ${e.message}`);
    }
  }

  // 握手时查流尾续 seq（防与重启前 server 写入的 seq 冲突）
  async function initSeq() {
    if (!redisReady || !taskId) return;
    try {
      const rows = await redis.xrevrange(`stream:task:${taskId}`, '+', '-', 'COUNT', 1);
      if (rows && rows.length) {
        const p = JSON.parse(rows[0][1][1] || '{}');
        if (typeof p.seq === 'number') seq = p.seq;
        log(`seq resumed from stream tail: ${seq}`);
      }
    } catch (e) { log(`initSeq failed: ${e.message}`); }
  }

  // ============ 旁路：直落 DB 终态（UPDATE conversation_messages） ============
  async function finalize(status, extra = {}) {
    if (!pgPool || !aiMessageId) return;
    try {
      const fields = ['status = $1'];
      const values = [status];
      let idx = 2;
      const sanitize = (v) => (typeof v === 'string' ? v.replace(/\0/g, '') : v);
      if (extra.content !== undefined) { fields.push(`content = $${idx++}`); values.push(sanitize(extra.content)); }
      if (extra.error !== undefined) { fields.push(`error = $${idx++}`); values.push(sanitize(extra.error)); }
      if (extra.engine !== undefined) { fields.push(`engine = $${idx++}`); values.push(extra.engine); }
      values.push(aiMessageId);
      await pgPool.query(`UPDATE conversation_messages SET ${fields.join(', ')} WHERE id = $${idx}`, values);
      log(`finalize ${status} aiMessage=${aiMessageId.slice(0, 8)}`);
    } catch (e) { log(`finalize failed: ${e.message}`); }
  }

  // ============ 旁路：任务完成（turn/end） ============
  // 从 Redis 流读回全部 chunk 拼接（取消/异常退出时 content 可能漏累积——用流回填最完整）
  async function readBackContent() {
    if (!redisReady || !taskId) return content;
    try {
      const rows = await redis.xrevrange(`stream:task:${taskId}`, '+', '-', 'COUNT', 3000);
      const parts = [];
      for (let i = rows.length - 1; i >= 0; i--) { // 正序拼接
        try {
          const p = JSON.parse(rows[i][1][1] || '{}');
          if (p.type === 'chunk' && typeof p.content === 'string') parts.push(p.content);
        } catch { /* ignore */ }
      }
      const back = parts.join('');
      return back.length > content.length ? back : content;
    } catch { return content; }
  }

  async function onTurnEnd(reason) {
    if (finalizing) return;
    finalizing = true;
    doneFlag = true;
    const kind = (reason && reason.kind) || 'completed';
    if (kind === 'error') {
      const errMsg = (reason.error && reason.error.message) || 'unknown error';
      await xadd({ seq: ++seq, type: 'stream_error', taskId, error: errMsg });
      await finalize('failed', { content, error: errMsg, engine: 'dsh' });
    } else if (kind === 'aborted') {
      await xadd({ seq: ++seq, type: 'stream_end', taskId, cancelled: true });
      await finalize('cancelled', { content, engine: 'dsh' });
    } else {
      // completed / max-tokens / 其他 → 正常收尾
      await xadd({ seq: ++seq, type: 'stream_end', taskId, status: 'completed', content });
      await finalize('completed', { content, engine: 'dsh' });
    }
    log(`turn/end kind=${kind} → recycle agent (doneFlag=true)`);
    killChild();
  }

  // ============ 旁路：解析 agent stdout 行（事件 → Redis/DB） ============
  function onAgentLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined) return;          // 响应行：透传不管
    if (msg.method !== 'session.event') return; // 只关心事件流
    const evt = (msg.params && msg.params.event) || msg.params || {};
    const { type, data } = evt;
    if (!type) return;
    switch (type) {
      case 'assistant/chunk': {
        const chunk = data && data.chunk;
        if (!chunk) return;
        if (chunk.type === 'text-delta' && chunk.text) {
          content += chunk.text;
          xadd({ seq: ++seq, type: 'chunk', taskId, content: chunk.text });
        }
        // reasoning-delta：不落 Redis（与 server SSE 的 <thinking> 包装不一致，续传不渲染 thinking）
        return;
      }
      case 'tool/call': {
        let args = data && data.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* keep */ } }
        if (data && data.callId) toolCallMap.set(data.callId, data.name || 'unknown');
        xadd({ seq: ++seq, type: 'tool_event', taskId, tool: data ? data.name : 'unknown', status: 'running', args: args || {}, callId: data ? data.callId : undefined });
        return;
      }
      case 'tool/result': {
        const block = data && data.message && data.message.content && data.message.content[0];
        if (block && block.type === 'tool-result') {
          const output = (block.content || []).map((c) => c.text || '').join('\n');
          const toolName = toolCallMap.get(block.toolCallId) || 'unknown';
          xadd({
            seq: ++seq, type: 'tool_event', taskId, tool: toolName,
            status: block.isError ? 'error' : 'done',
            callId: block.toolCallId,
            result: block.isError ? undefined : output.slice(0, 500),
            error: block.isError ? (output || 'tool error') : undefined,
          });
          toolCallMap.delete(block.toolCallId);
        }
        return;
      }
      case 'todo/write': {
        if (data && Array.isArray(data.todos)) {
          xadd({ seq: ++seq, type: 'tool_event', taskId, tool: 'todo_write', status: 'done', todos: data.todos });
        }
        return;
      }
      case 'turn/end': {
        onTurnEnd(data && data.reason);
        return;
      }
      default: return;
    }
  }

  function parseAgentLines(d) {
    agentBuf += d.toString('utf8');
    let i;
    while ((i = agentBuf.indexOf('\n')) >= 0) {
      const line = agentBuf.slice(0, i).trim();
      agentBuf = agentBuf.slice(i + 1);
      if (!line) continue;
      onAgentLine(line);
    }
    if (agentBuf.length > 1024 * 1024) agentBuf = '';
  }

  // 解析 client→agent 请求行：检测 shutdown → cancelFlag（socket 断开时据此杀 agent）
  function detectShutdown(d) {
    clientBuf += d.toString('utf8');
    let i;
    while ((i = clientBuf.indexOf('\n')) >= 0) {
      const line = clientBuf.slice(0, i).trim();
      clientBuf = clientBuf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (m.method === 'shutdown' && m.id !== undefined && !m.result && !m.error) {
          cancelFlag = true;
          log('cancel flag set (shutdown request detected)');
        }
      } catch { /* ignore */ }
    }
    if (clientBuf.length > 256 * 1024) clientBuf = '';
  }

  socket.on('error', (e) => log(`socket error: ${e.message}`));

  socket.on('close', () => {
    // ★ 断开语义：任务未完成且未取消 → 不杀 agent（server 崩溃场景，生成继续旁路落盘）；
    //   已完成/已取消 → 回收进程
    if (doneFlag || cancelFlag) killChild();
    log(`socket closed (done=${doneFlag} cancel=${cancelFlag} childAlive=${!!child})`);
  });

  socket.on('data', (chunk) => {
    if (handshakeDone) {
      detectShutdown(chunk);
      if (child && child.stdin.writable) child.stdin.write(chunk);
      return;
    }
    // 握手阶段：累积到第一个 \n
    buf += chunk.toString('utf8');
    const i = buf.indexOf('\n');
    if (i < 0) {
      if (buf.length > 64 * 1024) socket.destroy(); // 防滥用
      return;
    }
    const line = buf.slice(0, i).trim();
    const rest = buf.slice(i + 1);
    if (!line) { buf = rest; return; } // 空行（端口探针/keepalive）：忽略继续等真握手
    let hs;
    try {
      hs = JSON.parse(line);
    } catch {
      log('invalid handshake JSON');
      socket.destroy();
      return;
    }
    handshakeDone = true;
    const env = { ...process.env, ...(hs.env || {}) };
    const args = Array.isArray(hs.args) && hs.args.length ? hs.args : DEFAULT_ARGS;
    taskId = env.DSH_TASK_ID || '';
    aiMessageId = env.DSH_AI_MESSAGE_ID || '';
    child = spawn(DSH_EXE, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    log(`spawned pid=${child.pid} task=${taskId.slice(0, 8)} aiMessage=${(aiMessageId || '-').slice(0, 8)}`);
    initSeq().then(() => log(`seq initialized: ${seq}`)).catch(() => {});
    child.stdout.on('data', (d) => {
      if (socket.writable) socket.write(d);   // 透传照旧
      parseAgentLines(d);                      // ★ 旁路解析
    });
    child.stderr.on('data', (d) => process.stderr.write(`[agent-stderr] ${d}`));
    child.on('exit', (code, signal) => {
      log(`agent exited code=${code} signal=${signal} done=${doneFlag} cancel=${cancelFlag}`);
      // 异常退出兜底：任务未正常收尾 → 通知流 + 落库终态（幂等）
      if (!doneFlag && !finalizing) {
        finalizing = true;
        // 延迟收尾：agent 退出瞬间 stdout 管道可能还有未处理的 chunk 事件（取消/异常场景
        // content 会漏累积）——等 300ms 让 data 事件处理完，再从 Redis 回填完整内容
        setTimeout(async () => {
          if (cancelFlag) {
            xadd({ seq: ++seq, type: 'stream_end', taskId, cancelled: true });
            const c = await readBackContent();
            finalize('cancelled', { content: c, engine: 'dsh' });
          } else {
            const errMsg = `agent exited unexpectedly (code=${code} signal=${signal})`;
            xadd({ seq: ++seq, type: 'stream_error', taskId, error: errMsg });
            const c = await readBackContent();
            finalize('failed', { content: c, error: errMsg, engine: 'dsh' });
          }
        }, 300);
      }
      socket.end();
      child = null;
    });
    if (rest.length && child.stdin.writable) child.stdin.write(rest);
  });
});

server.on('error', (e) => {
  process.stderr.write(`[dsh-bridge-tcp] server error: ${e.message}\n`);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`[dsh-bridge-tcp] listening on 0.0.0.0:${PORT} (bypass=${REDIS_URL ? 'on' : 'off'})\n`);
});

// 旁路客户端异步初始化（失败不影响主链路）
initClients().catch((e) => process.stderr.write(`[dsh-bridge-tcp] initClients failed: ${e.message}\n`));
