/**
 * dsh-bridge.js — DeepSeek Harness SDK JSON-RPC 桥
 *
 * 把 madazi 的任务请求转发给 dsh-agent（SDK JSON-RPC 协议，有流式 session.event），
 * 并把 SDK session.event 流翻译成 madazi 可消费的回调（chunk/thinking/tool/usage/done）。
 *
 * 协议依据：@deepseek-ai/dsh-sdk-jsonrpc-server（packages/sdk/server/src/server.ts）：
 *   - initialize: { cwd, provider, model, maxTokens? } -> { serverInfo }
 *   - session/prompt: { sessionId, contentBlocks:[{type:'text',text}] } -> { messageId }
 *       —— 非阻塞：立即返回 messageId；agent 异步处理，结果通过 session.event 通知推送
 *   - session/event 通知: { sessionId, event: { type, data } }
 *       —— event.type ∈ assistant/chunk (text-delta/reasoning-delta = 流式)
 *                   assistant/message (完整消息 + usage)
 *                   tool/call, tool/result
 *                   turn/end (turn 完成信号: reason.kind ∈ completed|aborted|error|max-tokens|...)
 *                   todo/write (todo 列表快照)
 *   - session.status 通知: { sessionId, status }
 *   - shutdown: -> {}
 *
 * 用法：
 *   const bridge = new DshBridge({ exe, configPath, cwd, env, provider, model });
 *   await bridge.start();                       // spawn + initialize 握手
 *   const sessionId = await bridge.newSession(); // 生成 UUID（SDK 模式下 session 按需创建）
 *   const { stopReason, text } = await bridge.prompt(sessionId, '任务文本', { onChunk, onThinking, onToolEvent, onUsage });
 *   await bridge.stop();                        // shutdown + kill
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

export class DshBridgeError extends Error {
  constructor(message, { code = 'DSH_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'DshBridgeError';
    this.code = code;
  }
}

export class DshBridge {
  /**
   * @param {object} opts
   * @param {string} [opts.exe]       dsh-agent 可执行文件绝对路径（spawn 模式）
   * @param {string} [opts.configPath] cordis.yml 配置文件绝对路径
   * @param {string} opts.cwd        工作目录（initialize cwd，必须绝对路径）
   * @param {object} [opts.env]      额外环境变量（DEEPSEEK_API_KEY/DEEPSEEK_BASE_URL/DSH_*）
   * @param {string} [opts.provider] 模型提供方（默认 'deepseek-official'）
   * @param {string} [opts.model]    模型 ID（默认 'deepseek-v4-flash'）
   * @param {object} [opts.tcp]      TCP 模式：{ host, port }（K8s：dsh Pod 7001 TCP-stdio 桥）
   * @param {number} [opts.spawnTimeoutMs]  握手超时（默认 30s）
   * @param {number} [opts.requestTimeoutMs] 请求超时（默认 15 分钟，长任务）
   */
  constructor(opts) {
    this.opts = opts;
    this.child = null;
    this.started = false;
    this._buf = '';
    this._seq = 0;
    this._pending = new Map();     // id -> { resolve, reject, timer }
    this._events = new EventEmitter();
    this._serverInfo = null;
    this._onData = this._onData.bind(this);
  }

  /** 当前是否已握手成功且进程存活 */
  get connected() {
    return this.started && !!this.child && !this.child.killed && this.child.exitCode === null;
  }

  /**
   * 启动子进程并完成 initialize 握手。
   * TCP 模式（opts.tcp）：net.connect 到 dsh Pod 桥，socket 包成伪 child 复用全部 JSON-RPC 逻辑。
   */
  async start() {
    if (this.opts.tcp) return this._startTcp();

    const { exe, configPath, env = {}, spawnTimeoutMs = 30_000 } = this.opts;
    const child = spawn(exe, [configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env,
        DSH_CWD: env.DSH_CWD ?? this.opts.cwd ?? process.cwd(),
      },
    });
    this.child = child;
    child.stdout.on('data', this._onData);
    child.stderr.on('data', (d) => this._events.emit('stderr', d.toString()));

    child.on('exit', (code, signal) => {
      this.started = false;
      const err = new DshBridgeError(`dsh 进程退出 code=${code} signal=${signal}`, { code: 'DSH_EXIT' });
      for (const [, p] of this._pending) p.reject(err);
      this._pending.clear();
      this._events.emit('exit', { code, signal });
    });

    await Promise.race([
      this._handshake(),
      sleep(spawnTimeoutMs).then(() => { throw new DshBridgeError('initialize 握手超时', { code: 'DSH_HANDSHAKE_TIMEOUT' }); }),
    ]);
    this.started = true;
    return this._serverInfo;
  }

  /**
   * TCP 模式启动：连 dsh Pod 7001 桥，发握手行（env/args），socket 伪 child。
   */
  async _startTcp() {
    const { tcp, env = {}, cwd, spawnTimeoutMs = 60_000 } = this.opts;
    const socket = await new Promise((resolve, reject) => {
      const s = net.connect({ host: tcp.host, port: tcp.port });
      const t = setTimeout(() => {
        s.destroy();
        reject(new DshBridgeError(`连接 dsh Pod 桥超时 ${tcp.host}:${tcp.port}`, { code: 'DSH_TCP_CONNECT_TIMEOUT' }));
      }, 10_000);
      s.once('connect', () => { clearTimeout(t); s.setNoDelay(true); resolve(s); });
      s.once('error', (e) => { clearTimeout(t); reject(new DshBridgeError(`连接 dsh Pod 桥失败: ${e.message}`, { code: 'DSH_TCP_CONNECT_FAILED' })); });
    });

    const fake = {
      stdin: { write: (d) => socket.writable && socket.write(d) },
      stdout: socket,
      stderr: new EventEmitter(),
      killed: false,
      exitCode: null,
      kill(sig) {
        this.killed = true;
        try { socket.destroy(); } catch { /* ignore */ }
        return true;
      },
      once(ev, fn) { return socket.once(ev === 'exit' ? 'close' : ev, fn); },
      on(ev, fn) { return socket.on(ev === 'exit' ? 'close' : ev, fn); },
    };
    this.child = fake;
    socket.on('data', this._onData);
    socket.on('close', () => {
      fake.exitCode = fake.killed ? 0 : 1;
      this.started = false;
      const err = new DshBridgeError('dsh TCP 桥连接关闭', { code: 'DSH_EXIT' });
      for (const [, p] of this._pending) p.reject(err);
      this._pending.clear();
      this._events.emit('exit', { code: fake.exitCode, signal: null });
    });

    socket.write(JSON.stringify({ env, args: ['/app/cordis.yml'] }) + '\n');
    await Promise.race([
      this._handshake(),
      sleep(spawnTimeoutMs).then(() => { throw new DshBridgeError('initialize 握手超时（TCP）', { code: 'DSH_HANDSHAKE_TIMEOUT' }); }),
    ]);
    this.started = true;
    return this._serverInfo;
  }

  async _handshake() {
    // SDK 握手：cwd + provider + model
    const res = await this.request('initialize', {
      cwd: this.opts.cwd || process.cwd(),
      provider: this.opts.provider || 'deepseek-official',
      model: this.opts.model || 'deepseek-v4-flash',
    });
    this._serverInfo = res; // { serverInfo: { name, version } }
    return this._serverInfo;
  }

  /**
   * 生成 session ID（SDK 模式下 session 在 session/prompt 时按需创建）。
   * ★ madazi 会话级：调用方传入稳定 key（conversationId/taskId）→ 同会话 resume 命中历史；
   * 无参保持 randomUUID（一次性无状态调用，如导入分析/选中代码编辑）。
   * @param {string} [sessionId] 稳定会话 key（推荐 UUID）
   * @returns {string} sessionId
   */
  async newSession(sessionId) {
    return sessionId || randomUUID();
  }

  /**
   * 发送 prompt，流式接收 session.event 通知直到 turn 完成。
   *
   * SDK session/prompt 是非阻塞请求：立即返回 { messageId }，
   * agent 异步处理消息，结果通过 session.event 通知流式推送。
   * turn 完成后收到 turn/end 事件，prompt 方法 resolve。
   *
   * @param {string} sessionId
   * @param {string} text 用户任务文本
   * @param {object} [handlers]
   * @param {(chunk:string)=>void} [handlers.onChunk]       文本增量（assistant/chunk text-delta）
   * @param {(thinking:string)=>void} [handlers.onThinking]   思考增量（assistant/chunk reasoning-delta）
   * @param {(evt:object)=>void} [handlers.onToolEvent]     工具事件（tool/call / tool/result）
   * @param {(usage:object)=>void} [handlers.onUsage]       计费（assistant/message usage）
   * @param {(evt:object)=>void} [handlers.onEvent]         任意 session.event（透传，调试/扩展用）
   * @param {(stderr:string)=>void} [handlers.onStderr]
   * @returns {Promise<{stopReason:string, text:string, thinking:string, usage:object|null, messageId:string|null}>}
   */
  async prompt(sessionId, text, handlers = {}) {
    const chunks = [];
    const thinkChunks = [];
    let usage = null;
    let messageId = null;

    const onChunk = handlers.onChunk ?? (() => {});
    const onThinking = handlers.onThinking ?? (() => {});
    const onToolEvent = handlers.onToolEvent ?? (() => {});
    const onUsage = handlers.onUsage ?? (() => {});
    const onEvent = handlers.onEvent ?? (() => {});
    const onStderr = handlers.onStderr ?? (() => {});

    let turnEndResolve, turnEndReject;
    const turnEndPromise = new Promise((resolve, reject) => {
      turnEndResolve = resolve;
      turnEndReject = reject;
    });

    const eventListener = (payload) => {
      if (payload?.sessionId && payload.sessionId !== sessionId) return;
      const event = payload?.event;
      if (!event) return;
      const { type, data } = event;

      onEvent(event);

      switch (type) {
        case 'assistant/chunk': {
          const chunk = data.chunk;
          if (!chunk) return;
          if (chunk.type === 'text-delta' && chunk.text) {
            chunks.push(chunk.text);
            onChunk(chunk.text);
          } else if (chunk.type === 'reasoning-delta' && chunk.text) {
            thinkChunks.push(chunk.text);
            onThinking(chunk.text);
          }
          return;
        }
        case 'assistant/message': {
          if (data.usage) {
            usage = data.usage;
            onUsage(usage);
          }
          return;
        }
        case 'tool/call': {
          // SDK: { turn, step, callId, name, arguments }
          let args = data.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { /* keep string */ }
          }
          onToolEvent({
            kind: 'tool/call',
            name: data.name,
            arguments: args,
            callId: data.callId,
          });
          return;
        }
        case 'tool/result': {
          // SDK: { turn, step, message: { content: [{ type:'tool-result', toolCallId, content: [{type:'text',text}], isError? }] }, error? }
          const block = data.message?.content?.[0];
          if (block?.type === 'tool-result') {
            const output = (block.content || [])
              .map(c => c?.text || '')
              .join('\n');
            onToolEvent({
              kind: 'tool/result',
              callId: block.toolCallId,
              error: block.isError ? (output || 'tool error') : undefined,
              output: block.isError ? undefined : output,
            });
          }
          return;
        }
        case 'todo/write': {
          if (data.todos) {
            onToolEvent({ kind: 'todo/write', todos: data.todos });
          }
          return;
        }
        case 'turn/end': {
          const reason = data.reason || {};
          if (reason.kind === 'error') {
            turnEndReject(new DshBridgeError(
              `turn error: ${reason.error?.message || 'unknown'}`,
              { code: 'DSH_TURN_ERROR' },
            ));
          } else {
            turnEndResolve({
              stopReason: reason.kind === 'completed' ? 'end_turn' : reason.kind,
              text: chunks.join(''),
              thinking: thinkChunks.join(''),
              usage,
              messageId,
            });
          }
          return;
        }
        default:
          return;
      }
    };
    const stderrListener = (d) => onStderr(d);

    this._events.on('session.event', eventListener);
    this._events.on('stderr', stderrListener);
    // ★ socket 断开（取消/桥退出）时必须结束 turn——否则 turnEndPromise 挂到超时，
    //   finally 不执行 → SSE done 永不发出（前端转圈等 15min）
    const onExit = () => {
      turnEndReject(new DshBridgeError('dsh 连接关闭（任务取消或桥退出）', { code: 'DSH_ABORTED' }));
    };
    this._events.once('exit', onExit);

    try {
      // SDK session/prompt 非阻塞：立即返回 { messageId }
      const res = await this.request('session/prompt', {
        sessionId,
        contentBlocks: [{ type: 'text', text }],
      });
      messageId = res?.messageId ?? null;
      // 等待 turn/end 事件
      return await Promise.race([
        turnEndPromise,
        sleep(this.opts.requestTimeoutMs ?? 900_000).then(() => {
          throw new DshBridgeError('turn 等待超时', { code: 'DSH_TURN_TIMEOUT' });
        }),
      ]);
    } finally {
      this._events.off('session.event', eventListener);
      this._events.off('stderr', stderrListener);
      this._events.off('exit', onExit);
    }
  }

  /** 取消进行中的 turn。SDK 无原生 cancel；关闭连接来中断。 */
  cancel(/* sessionId */) {
    // SDK 协议没有 session/cancel 方法
    // 取消通过关闭连接实现（chat-tasks 会随后调用 stop）
  }

  /**
   * 发送 JSON-RPC 请求，等待响应。
   */
  request(method, params) {
    if (!this.child || this.child.killed) {
      return Promise.reject(new DshBridgeError('dsh 子进程未启动', { code: 'DSH_NOT_STARTED' }));
    }
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const t = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new DshBridgeError(`请求超时: ${method}`, { code: 'DSH_REQUEST_TIMEOUT' }));
        }
      }, this.opts.requestTimeoutMs ?? 900_000);
      this._pending.get(id).timer = t;
    });
  }

  /** 发送通知（不等待响应）。 */
  notify(method, params) {
    if (!this.child || this.child.killed) throw new DshBridgeError('dsh 子进程未启动', { code: 'DSH_NOT_STARTED' });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  /** 优雅关闭：先发 shutdown，再兜底 kill。 */
  async stop() {
    if (this.child && !this.child.killed) {
      try { await this.request('shutdown').catch(() => {}); } catch { /* ignore */ }
      const exited = await Promise.race([
        new Promise((r) => this.child.once('exit', () => r(true))),
        sleep(3000).then(() => false),
      ]);
      if (!exited && !this.child.killed) {
        try { this.child.kill('SIGKILL'); } catch { /* ignore */ }
        await new Promise((r) => { this.child.once('exit', r); setTimeout(r, 1500).unref(); });
      }
    }
    this.started = false;
  }

  /**
   * 取消当前任务（★ SDK 无 session 级取消；每任务一进程 → shutdown 优雅退出 + 兜底强断）。
   * 内桥旁路会解析到 shutdown 请求行并标记 cancelFlag，socket 断开时据此强杀 agent。
   */
  cancel() {
    if (!this.child || this.child.killed) return;
    try {
      const id = ++this._seq;
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'shutdown', params: {} }) + '\n');
    } catch { /* ignore */ }
    // 兜底：3s 后强断（内桥 cancelFlag 已标记 → 杀 agent 进程）
    setTimeout(() => {
      try { this.child.kill('SIGKILL'); } catch { /* ignore */ }
    }, 3000).unref();
  }
  _onData(data) {
    this._buf += data.toString();
    let i;
    while ((i = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, i).trim();
      this._buf = this._buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    // 响应（有 id + result/error）
    if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this._pending.get(msg.id);
      if (p) {
        this._pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new DshBridgeError(msg.error.message ?? 'JSON-RPC error', { code: String(msg.error.code ?? 'DSH_RPC') }));
        else p.resolve(msg.result ?? {});
      }
      return;
    }
    // 服务端通知：session.event 是关键流式通道
    if (msg.method === 'session.event') {
      this._events.emit('session.event', msg.params);
      return;
    }
    if (msg.method === 'session.status') {
      this._events.emit('session.status', msg.params);
      return;
    }
    if (msg.method) {
      this._events.emit(msg.method, msg.params);
    }
  }
}

// 便捷函数：完整跑一轮任务，收集全部输出
export async function runDshTask({ exe, configPath, cwd, env, provider, model, text, onChunk, onThinking, onToolEvent, onUsage, requestTimeoutMs }) {
  const bridge = new DshBridge({ exe, configPath, cwd, env, provider, model, requestTimeoutMs });
  let sessionId = null;
  try {
    await bridge.start();
    sessionId = await bridge.newSession();
    const result = await bridge.prompt(sessionId, text, { onChunk, onThinking, onToolEvent, onUsage });
    return { sessionId, ...result };
  } finally {
    if (bridge.connected) await bridge.stop().catch(() => {});
  }
}
