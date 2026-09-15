import { Router } from 'express';
import httpProxy from 'http-proxy';
import { startPreview, stopPreview, getPreview, getAllPreviews, touchPreview, resolvePreviewPort, previewBackend, previewUrlFor } from '../services/preview.js';

// ★ 多人协同操作锁：per-project，防多用户并发 stop/restart/hard-restart 互踢。
//   startPreview 自身已有幂等复用逻辑（existing.status check），不需加锁。
//   锁生命周期 = 操作执行期（秒级~分钟级），操作完成或超时自动释放。
const _opLocks = new Map(); // projectId -> { op, user, at }
const OP_LOCK_TTL = 120000;  // 2 分钟兜底（硬重建最长 ~90s）

function tryAcquireOpLock(projectId, op, user) {
  const now = Date.now();
  const existing = _opLocks.get(projectId);
  if (existing && (now - existing.at) < OP_LOCK_TTL) {
    return { ok: false, heldBy: existing.op, user: existing.user };
  }
  _opLocks.set(projectId, { op, user: user || 'unknown', at: now });
  return { ok: true };
}

function releaseOpLock(projectId) {
  _opLocks.delete(projectId);
}
import { subscribeBuildLog } from '../services/docker-build.js';
import { getHistory, getCommitDiff, rollbackToCommit } from '../services/chat.js';
import { createTask, getProjectTasks, getTask, cancelTask, checkFileConflicts, rollbackTask, approveToolCall, subscribeTask } from '../services/chat-tasks.js';
import { readTaskEvents, readTaskEventsLive } from '../services/redis.js';
import {
  getConversations,
  getConversation,
  createConversation,
  renameConversation,
  deleteConversation,
  forkConversation,
  truncateMessagesAfter,
  updateUserMessageContent,
  addUserMessage,
  addAiMessage,
  updateAiMessage,
  updateAiMessageByTaskId,
  getAiMessageByTaskId,
} from '../services/conversations.js';
import { runInitiateViaChat, saveInitiateAsAiMessage } from '../services/initiate-via-chat.js';
import { runExecutePlan, listPlanModules } from '../services/execute-plan.js';
import { buildCodebaseIndex, searchCodebase, getIndexStatus } from '../services/codebase-index.js';
import { chatStream } from '../services/llm.js';
import { db } from '../db/init.js';
import { auth } from '../middleware/auth.js';
import { projectAccess } from '../middleware/permission.js';
import { broadcastChatEvent } from '../services/project-ws.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = Router();

// 所有 API 路由必须登录 + 校验项目访问权限
router.use(auth);
router.use(projectAccess);
const proxy = httpProxy.createProxyServer({ ws: true });

// ★ inspector 脚本：server 端注入到预览 iframe HTML（不依赖宿主机 nginx sub_filter）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let inspectorScript = '';
try {
  // 开发：madazi-server/public/madazi-inspector.js；Docker: /app/public/madazi-inspector.js
  const p1 = path.join(__dirname, '../../public/madazi-inspector.js');
  const p2 = path.join(__dirname, '../../madazi-web/public/madazi-inspector.js');
  inspectorScript = fs.readFileSync(fs.existsSync(p1) ? p1 : p2, 'utf8');
  console.log('[inspector] loaded madazi-inspector.js', inspectorScript.length, 'bytes');
} catch (e) {
  console.warn('[inspector] madazi-inspector.js not found, Network/Elements panels will be empty:', e.message);
}

// ★ 子域名预览专用代理：selfHandleResponse 拦截 HTML 注入 inspector 脚本
const subProxy = httpProxy.createProxyServer({ selfHandleResponse: true });
subProxy.on('proxyReq', (proxyReq) => {
  proxyReq.setHeader('Host', 'localhost:5173');
  // 禁 gzip：需读明文 HTML 注入 <script>
  proxyReq.setHeader('Accept-Encoding', 'identity');
});
subProxy.on('proxyRes', (proxyRes, req, res) => {
  const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
  const isHtml = ct.includes('text/html');
  // 复制 headers（去掉 content-length，注入后会变）
  for (const [k, v] of Object.entries(proxyRes.headers)) {
    if (k.toLowerCase() === 'content-length') continue;
    res.setHeader(k, v);
  }
  res.statusCode = proxyRes.statusCode || 200;
  if (!isHtml || !inspectorScript) {
    // 非 HTML 或无 inspector：直接透传
    proxyRes.pipe(res);
    return;
  }
  // HTML：缓存 body，注入 <script> 后回写
  const chunks = [];
  proxyRes.on('data', (c) => chunks.push(c));
  proxyRes.on('end', () => {
    let body = Buffer.concat(chunks).toString('utf8');
    const tag = `<script>${inspectorScript}</script>`;
    if (body.includes('</body>')) {
      body = body.replace('</body>', tag + '</body>');
    } else {
      body += tag;
    }
    res.removeHeader('content-encoding');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
  });
  proxyRes.on('error', () => { try { res.end(); } catch {} });
});

// ★ 修复 Vite 6 allowedHosts 403：重写 Host 为 localhost
proxy.on('proxyReq', (proxyReq, req) => {
  proxyReq.setHeader('Host', 'localhost:5173');
});

// ★ 2026-09-08 崩溃根因修复（同 dsh-web-proxy）：http-proxy 无 error listener 时
//   连接失败直接 throw → 崩掉整个 server 进程（预览 pod 未就绪/被删窗口触发）。
proxy.on('error', (err, req, res) => {
  if (res && typeof res.status === 'function' && !res.headersSent) {
    res.status(502).json({ error: 'preview 代理不可用' });
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  } else {
    console.error('[preview] proxy error:', err && err.message);
  }
});
subProxy.on('error', (err, req, res) => {
  if (res && typeof res.status === 'function' && !res.headersSent) {
    res.status(502).json({ error: 'preview 子代理不可用' });
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  } else {
    console.error('[preview] subProxy error:', err && err.message);
  }
});

// ★ WS 握手同样重写 Host：http-proxy 的 WS 升级触发的是 proxyReqWs（非 proxyReq），
//   Vite 6 对 HMR WebSocket 握手校验 Host 头（安全修复），pv- 子域名 Host 未重写 → 400
proxy.on('proxyReqWs', (proxyReq, req) => {
  proxyReq.setHeader('Host', `localhost:${req._pvPort || 5173}`);
});

// ★ 调试：记录代理响应状态码
proxy.on('proxyRes', (proxyRes, req) => {
  console.log('[preview-proxy] <-', proxyRes.statusCode, req.originalUrl || req.url);
});

// 启动预览
// ★ 运行中的预览 Pod 列表（user 级，workbench Console 面板发现预览日志源用；不依赖 iframe 地址）
//   v2：补 name（projects 表联查）——DB 面板多项目切换下拉要用
router.get('/previews/running', async (req, res) => {
  try {
    const { listPreviewPods } = await previewBackend();
    const pods = await listPreviewPods();
    const running = (pods || [])
      // ★ 只留动态预览（sts 静态 pod madazi-preview-0/1 无 projectId，会污染 fallback 列表）
      .filter(p => p.phase === 'Running' && p.projectId)
      .map(p => {
      const pid8 = (p.name || '').replace(/^madazi-preview-/, '').slice(0, 8);
      // ★ 单机 docker：直连 http://127.0.0.1:<hostPort>/；K8s：pv-<id8> 子域名
      const url = process.env.PREVIEW_MODE === 'docker'
        ? (p.podIP && p.podIP.includes(':') ? `http://${p.podIP}/` : null)
        : (pid8 ? `https://pv-${pid8}.<YOUR-DOMAIN>.com/` : null);
      return {
        projectId: p.projectId,
        podName: p.name,
        pid8,
        url,
        startedAt: p.startedAt,
        phase: p.phase,
        ready: p.ready === true,
      };
    });
    // 补项目名（供切换下拉展示友好名字；失败不阻塞）
    try {
      if (running.length) {
        const ids = running.map((r) => r.projectId);
        const { rows } = await db.query('SELECT id, name FROM projects WHERE id = ANY($1)', [ids]);
        const nameMap = new Map(rows.map((r) => [r.id, r.name]));
        for (const r of running) r.name = nameMap.get(r.projectId) || null;
      }
    } catch (e) {
      console.warn('[preview] previews/running name lookup failed:', e.message);
    }
    res.json({ running });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/preview/start', async (req, res) => {
  try {
    const result = await startPreview(req.params.id, req.user?.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 停止预览
router.post('/:id/preview/stop', async (req, res) => {
  const lock = tryAcquireOpLock(req.params.id, 'stop', req.user?.username);
  if (!lock.ok) {
    return res.status(409).json({ error: `操作冲突：${lock.user} 正在执行 ${lock.heldBy}` });
  }
  try {
    await stopPreview(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOpLock(req.params.id);
  }
});

// 重启应用（软重启）：保留 Pod，杀应用进程 + 重跑启动段（秒级，环境保留）
// 依赖：entrypoint.sh 拆分后的 start.sh（PID 文件 /tmp/madazi-{fe,be}.pid）
router.post('/:id/preview/restart', async (req, res) => {
  const lock = tryAcquireOpLock(req.params.id, 'restart', req.user?.username);
  if (!lock.ok) {
    return res.status(409).json({ error: `操作冲突：${lock.user} 正在执行 ${lock.heldBy}` });
  }
  try {
    const projectId = req.params.id;
    const { getPreviewPodStatus } = await previewBackend();
    const st = await getPreviewPodStatus(projectId);
    if (!st.exists || !st.ready) {
      return res.status(400).json({ error: 'Preview 未运行，请先启动' });
    }
    // ★ 软重启：docker 模式 exec 直连容器；K8s 走 terminal-k8s（Pod 内命令）
    const { execPreviewPodCommand } = process.env.PREVIEW_MODE === 'docker'
      ? await previewBackend()
      : await import('../services/terminal-k8s.js');
    const cmd = [
      'kill $(cat /tmp/madazi-fe.pid /tmp/madazi-be.pid 2>/dev/null) 2>/dev/null; ',
      'pkill -f "vite|spring-boot|pnpm start|npm start|go run|./server|python app.py|python main.py|manage.py runserver" 2>/dev/null; ',
      'sleep 2; ',
      'rm -f /tmp/madazi-fe.pid /tmp/madazi-be.pid; ',
      'echo "[preview] ====== 软重启：重跑构建段 + 启动段 ======"; ',
      'nohup bash /app/entrypoint.sh > /proc/1/fd/1 2>&1 & ',
      'sleep 1; echo RESTART_APP_OK'
    ].join('');
    await execPreviewPodCommand(projectId, cmd, { timeoutMs: 20000 });
    res.json({ ok: true, status: 'restarting' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOpLock(req.params.id);
  }
});

// 重建 Pod（硬重启）：删 Pod/容器 重建（startPreview 幂等，重新 createPreviewPod + 全量构建）
router.post('/:id/preview/hard-restart', async (req, res) => {
  const lock = tryAcquireOpLock(req.params.id, 'hard-restart', req.user?.username);
  if (!lock.ok) {
    return res.status(409).json({ error: `操作冲突：${lock.user} 正在执行 ${lock.heldBy}` });
  }
  try {
    const projectId = req.params.id;
    // 删 Pod/容器 -> 等完全删除 -> 重建（startPreview 幂等，会重新 createPreviewPod）
    await stopPreview(projectId);
    const { waitPreviewPodGone } = await previewBackend();
    try { await waitPreviewPodGone(projectId, 30000); } catch (e) { console.warn('[preview] hard-restart: pod 删除等待超时，继续尝试重建', e.message); }
    const result = await startPreview(projectId);
    res.json({ ok: true, port: result?.port, status: result?.status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    releaseOpLock(req.params.id);
  }
});

// 预览状态
router.get('/:id/preview/status', async (req, res) => {
  const preview = getPreview(req.params.id);
  if (preview) {
    // ★ fork：内存有记录但 Pod 已被外部删除（kubectl delete/节点回收/崩溃）→ 返回未运行。
    // 否则前端误判 running：不显示「预览未启动」占位、不触发自动启动 → 用户仍见 Preview not found。
    // 不 touch（防止续期），内存残留记录由 startPreview 复用检查或空闲回收器清理。
    try {
      const { getPreviewPodStatus } = await previewBackend();
      const st = await getPreviewPodStatus(req.params.id);
      if (!st.exists) {
        return res.json({ running: false });
      }
      // ★ 修复(2026-08-22)：pod 存在但服务未就绪（构建中）→ 不算 running。
      // 否则前端 pvRunning=true：绿点亮、iframe 提前挂载 → Preview not found
      if (!st.ready) {
        touchPreview(req.params.id); // 构建中也续期，防空闲回收误杀
        return res.json({ running: false, status: 'starting', building: true });
      }
    } catch {
      // 探测异常保守视为未运行（前端自动启动兜底），绝不误报 running
      return res.json({ running: false });
    }

    // 更新访问时间，防止被空闲清理回收
    touchPreview(req.params.id);

    return res.json({
      running: true,
      status: 'ready',
      backendReady: preview.backendReady || false,
      frontendReady: preview.frontendReady || false,
      port: preview.port,
      url: previewUrlFor(req.params.id, preview.podIP),
    });
  }

  // 内存 Map 无记录（可能是服务器重启后）-> 查 Pod 是否实际存在
  try {
    const { getPreviewPodStatus } = await previewBackend();
    const st = await getPreviewPodStatus(req.params.id);
    if (st.ready) {
      return res.json({ running: true, status: 'ready', port: null, url: previewUrlFor(req.params.id, st.podIP), recovered: true });
    }
    if (st.exists && !st.ready) {
      return res.json({ running: false, stopped: true, status: 'starting' });
    }
  } catch {}

  return res.json({ running: false });
});

// 预览日志（启动日志/运行时日志）
router.get('/:id/logs', async (req, res) => {
  try {
    const { type } = req.query;
    const tail = type === 'startup' ? 500 : 200;
    // 模式化：直接从 Pod/容器 拉日志（不依赖内存 Map，在即有日志）
    const { getPreviewPodLogs } = await previewBackend();
    const { logs } = await getPreviewPodLogs(req.params.id, tail);
    return res.json({ logs, status: 'ready' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 运行期实时日志流（SSE）：轮询 getPreviewPodLogs 增量推送
// 覆盖：构建 + 启动 + 后端 + 前端全量 stdout（entrypoint/start.sh 输出）
router.get('/:id/preview/log-stream', async (req, res) => {
  const projectId = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 不缓冲
  });
  res.write('retry: 3000\n\n');

  const { getPreviewPodLogs } = await previewBackend();
  let lastLen = 0;
  const timer = setInterval(async () => {
    try {
      const { logs } = await getPreviewPodLogs(projectId, 3000);
      const text = String(logs || '');
      if (text.length > lastLen) {
        res.write(`data: ${JSON.stringify({ text: text.slice(lastLen) })}\n\n`);
        lastLen = text.length;
      }
    } catch (e) {
      // 轮询失败静默（Pod 消失等），下轮再试
    }
  }, 2500);

  res.on('close', () => clearInterval(timer));
  res.on('error', () => clearInterval(timer));
});

// 编译状态
router.get('/:id/build-status', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT build_status, build_errors FROM projects WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
    res.json({
      buildStatus: rows[0].build_status || 'pending',
      errors: rows[0].build_errors || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 构建日志 SSE 流式推送（优化4）
// 前端通过 EventSource 连接，实时接收构建进度日志
router.get('/:id/preview/build-log-stream', async (req, res) => {
  const projectId = req.params.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 不缓冲
  });
  res.write('retry: 3000\n\n');

  // ★ P2-8 修复：客户端断开时 res 触发 error，原代码未监听会抛 unhandled error 崩进程
  res.on('error', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });

  // 注册监听器
  const unsubscribe = subscribeBuildLog(projectId, (line, status) => {
    const payload = JSON.stringify({ line, status });
    res.write(`data: ${payload}\n\n`);
  });

  // 心跳保活（每 15 秒发送注释行，防止代理超时断开）
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // 客户端断开时清理
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// 代理预览请求（HTTP + WebSocket HMR）
// Exported as setupPreviewProxy for registration before express.json()
// ★ 处理预览子域名的 WebSocket 升级（Vite HMR 等）
// 在 index.js 的 server.on('upgrade') 中调用
// ★ 预览子域名根域：运行环境变量 PREVIEW_DOMAIN 注入（docker-compose 传参），默认 <YOUR-DOMAIN>.com
const PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN || '<YOUR-DOMAIN>.com';
// 正则动态拼：域名点号需转义，如 <YOUR-DOMAIN>.com -> <YOUR-DOMAIN>\.com
const PREVIEW_SUB_RE = new RegExp(`^pv-([a-z0-9]{8})\\.${PREVIEW_DOMAIN.replace(/\./g, '\\.')}`);
export async function handlePreviewWS(req, socket, head) {
  const host = req.headers.host || '';
  const subMatch = host.match(PREVIEW_SUB_RE);
  if (!subMatch) return false; // 不是预览子域名，交给其他 handler

  const projectPrefix = subMatch[1];
  const allPreviews = getAllPreviews();
  let found = allPreviews.find(p => p.projectId.startsWith(projectPrefix));

  // ★ K8s 恢复现场：Map 空但 Pod running，查 Pod 回填（Vite HMR WS 不中断）
  if (!found?.podIP) {
    try {
      const { findPreviewPodByPrefix } = await import('../services/preview-k8s.js');
      const hit = await findPreviewPodByPrefix(projectPrefix);
      if (hit) {
        const { recoverPreviewFromPod } = await import('../services/preview.js');
        found = await recoverPreviewFromPod(hit.projectId, hit.podIP, hit.podName);
      }
    } catch (e) {
      console.error('[preview-ws] recover failed:', e.message);
    }
  }

  // K8s：podIP 代理目标
  const target = found?.podIP
    ? `http://${found.podIP}:5173`
    : null;

  if (!target) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // 代理 WS 到容器 Vite dev server
  proxy.ws(req, socket, head, { target }, (err) => {
    console.error('[preview-ws] Error:', err.message, '| target:', target);
    socket.destroy();
  });
  return true; // 已处理
}

export function setupPreviewProxy(app) {
  // ★ 子域名预览：pv-{projectId前8位}.<YOUR-DOMAIN>.com -> 代理到对应容器
  // 跨域隔离：iframe 子域名与平台主域名(<YOUR-DOMAIN>)不同源，浏览器自动阻止 window.top 访问
  // 用 pv- 前缀避免与其他子域名(madazi/edu/badminton等)冲突
  // ★ 子域名本身就是鉴权：UUID 前8位 = 16^8 ≈ 43亿种组合，不可猜测，无需 token
  app.use(async (req, res, next) => {
    const host = req.headers.host || '';
    const subMatch = host.match(PREVIEW_SUB_RE);
    if (!subMatch) return next();

    const projectPrefix = subMatch[1];

    // 通过前缀在内存 Map 中找 projectId
    const allPreviews = getAllPreviews();
    let found = allPreviews.find(p => p.projectId.startsWith(projectPrefix));

    // ★ K8s 恢复现场：Map 空但 Pod running，查 Pod 回填（子域名预览不断服）
    if (!found?.podIP) {
      try {
        const { findPreviewPodByPrefix } = await import('../services/preview-k8s.js');
        const hit = await findPreviewPodByPrefix(projectPrefix);
        if (hit) {
          const { recoverPreviewFromPod } = await import('../services/preview.js');
          found = await recoverPreviewFromPod(hit.projectId, hit.podIP, hit.podName);
        }
      } catch (e) {
        console.error('[subdomain-preview] recover failed:', e.message);
      }
    }

    // 代理目标：K8s 用 podIP（无 Pod -> 404）；★ 端口自适应：导入项目实际端口由 .preview-port 回写
    let target;
    if (found?.podIP) {
      const pvPort = found.projectId ? await resolvePreviewPort(found.projectId) : null;
      req._pvPort = pvPort || 5173;
      target = `http://${found.podIP}:${req._pvPort}`;
    } else {
      return res.status(404).send('Preview not found');
    }

    if (found?.projectId) touchPreview(found.projectId);

    // ★ 子域名请求路径直接透传，无需重写
    // / -> /, /src/main.tsx -> /src/main.tsx, /api/xxx -> /api/xxx

    // 代理到容器 Vite dev server（用 subProxy：HTML 注入 inspector 脚本）
    subProxy.web(req, res, { target }, (err) => {
      console.error('[subdomain-preview] Error:', err.message, '| target:', target);
      if (err.message.includes('ECONNREFUSED') || err.message.includes('EAI_AGAIN')) {
        res.status(502).send('Preview is starting, please wait...');
      } else {
        res.status(502).send('Preview error: ' + err.message);
      }
    });
  });
}

// 对话修改代码（任务化 SSE：多任务并行 + 文件锁 + 会话上下文）
//
// 流程：
//   1. 接收 { message, conversationId }
//      - 如果没传 conversationId，自动创建一个新会话
//   2. 把用户消息存入 conversation_messages
//   3. 创建任务入队（任务内部会创建 AI 占位消息）
//   4. SSE 推送 task_created 事件
//   5. 任务执行期间通过 onChunk 推送 chunk 事件
//   6. 任务完成/失败/取消时推送对应事件
//
// 多轮对话：任务执行时从 conversation_messages 加载历史作为 AI 上下文
router.post('/:id/chat', async (req, res) => {
  const { message, conversationId: clientConvId, attachments, skill, skillPrompt, modelConfigId, mode, suggestMode, regenerateMessageId, editMessageId } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  const projectId = req.params.id;
  const userId = req.user?.id || 'anonymous';

  // ===== 特殊指令：初始化项目（项目创建后自动触发） =====
  // message === '[INITIATE_PROJECT]' 或 body.mode === 'initiate'
  // 走 initiate 流程但用 chat 协议 SSE 输出，让进度在 AI 对话框流式渲染
  const isInitiate = message.trim() === '[INITIATE_PROJECT]' || req.body.mode === 'initiate';

  if (isInitiate) {
    return runInitiateChatSSE(req, res);
  }

  // ===== 特殊指令：按计划生成代码 =====
  const isExecutePlan = message.trim() === '[EXECUTE_PLAN]' || req.body.mode === 'execute-plan';
  if (isExecutePlan) {
    return runExecutePlanSSE(req, res);
  }

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // 防止 Nginx/反代缓冲，保证 SSE 实时推送
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // 客户端断开时标记任务取消（防止僵尸任务占用锁）
  let clientClosed = false;
  // 注意：用 res.on('close') 而非 req.on('close')，因为 req 的 close
  // 会在请求体读取完就触发（此时响应还没发完），导致 SSE 被误判为断开
  res.on('close', () => {
    clientClosed = true;
  });

  // SSE 写入辅助函数（断开后静默丢弃）
  const send = (obj) => {
    if (clientClosed) return;
    try {
      res.write('data: ' + JSON.stringify(obj) + '\n\n');
    } catch {}
  };

  try {
    // 1. 确定会话：没有则创建新会话
    let conversationId = clientConvId;
    if (!conversationId) {
      const conv = await createConversation(projectId, userId, message.slice(0, 60));
      conversationId = conv.id;
      send({ type: 'conversation_created', conversationId, title: conv.title });
    }

    // ★ 编辑模式：更新用户消息内容 + 截断后续消息
    // ★ 重新生成模式：截断该 AI 消息及之后的所有消息，然后用上一条用户消息重新创建任务
    if (editMessageId) {
      // 编辑用户消息 -> 更新内容 -> 截断该消息之后的所有消息（含旧 AI 回复）
      await updateUserMessageContent(editMessageId, message);
      await truncateMessagesAfter(conversationId, editMessageId);
      // 通知前端截断完成
      send({ type: 'messages_truncated', conversationId, afterMessageId: editMessageId });
      // 不再 addUserMessage，直接用编辑后的消息创建任务
    } else if (regenerateMessageId) {
      // 重新生成：找到该 AI 消息，截断它和之后所有消息，然后用上一条用户消息重新创建任务
      await truncateMessagesAfter(conversationId, regenerateMessageId);
      // 也删除该 AI 消息本身
      await db.query('DELETE FROM conversation_messages WHERE id = $1', [regenerateMessageId]);
      send({ type: 'messages_truncated', conversationId, afterMessageId: regenerateMessageId, includeSelf: true });
      // 不 addUserMessage，用已有历史创建任务
    } else {
      // 2. 存用户消息
      await addUserMessage(conversationId, message, userId);
    }

    // ★ 协同广播：通知其他在线成员有新用户消息
    broadcastChatEvent(projectId, {
      type: 'chat:user_message',
      conversationId,
      userId,
      username: req.user?.username || '匿名',
      message,
    }, userId);

    // ★ 2.5 预检：预测要改的文件，检查和正在运行的任务是否冲突
    // worktree 模式下不阻塞，仅 warning 提示
    const conflictCheck = await checkFileConflicts(projectId, message);
    if (conflictCheck.warning) {
      const taskMsgs = conflictCheck.conflictingTasks.map(t => `「${t.message}」`).join('、');
      const fileList = conflictCheck.files.slice(0, 5).join(', ');
      const moreHint = conflictCheck.files.length > 5 ? ` 等${conflictCheck.files.length}个文件` : '';
      // 仅推送 warning，不阻塞任务创建
      send({
        type: 'warning',
        conversationId,
        message: `⚠️ ${taskMsgs} 正在修改相同文件（${fileList}${moreHint}），合并时可能需要处理冲突`,
        conflictingFiles: conflictCheck.files,
        conflictingTasks: conflictCheck.conflictingTasks,
      });
    }

    // chunk 节流缓冲（协同广播用）
    let chatChunkBuffer = '';
    let chatChunkTimer = null;

    // 3. 创建任务并入队
    const task = await createTask({
      projectId,
      userId,
      message,
      conversationId,
      attachments: attachments || null,
      skill: skill || null,
      skillPrompt: skillPrompt || null,
      modelConfigId: modelConfigId || null,
      mode: mode || null,
      suggestMode: !!suggestMode,  // ★ P1-1 审批模式
      onChunk: (chunk) => {
        send({ type: 'chunk', taskId: task?.id, content: chunk });
        // ★ 协同广播：AI 流式输出（节流 200ms flush 一次）
        chatChunkBuffer += chunk;
        if (!chatChunkTimer) {
          chatChunkTimer = setTimeout(() => {
            if (chatChunkBuffer && !clientClosed) {
              broadcastChatEvent(projectId, {
                type: 'chat:chunk',
                conversationId,
                taskId: task?.id,
                content: chatChunkBuffer,
              }, userId);
            }
            chatChunkBuffer = '';
            chatChunkTimer = null;
          }, 200);
        }
      },
      // ★ 结构化工具事件 -> 转发为 SSE
      onToolEvent: (evt) => send({ type: 'tool_event', taskId: task?.id, ...evt }),
    });

    // 4. 通知前端任务已创建
    send({ type: 'task_created', taskId: task.id, conversationId, status: task.status, targetFiles: task.targetFiles });

    // ★ 协同广播：通知其他在线成员 AI 任务已创建
    broadcastChatEvent(projectId, {
      type: 'chat:task_created',
      conversationId,
      taskId: task.id,
      username: req.user?.username || '匿名',
    }, userId);

    // 5. 轮询任务状态，终态时推送对应事件并关闭 SSE
    const pollInterval = setInterval(() => {
      if (clientClosed) {
        clearInterval(pollInterval);
        return;
      }
      const current = getTask(projectId, task.id);
      if (!current) return;

      // 终态处理
      if (current.status === 'completed') {
        clearInterval(pollInterval);
        send({
          type: 'done',
          taskId: task.id,
          conversationId,
          status: 'completed',
          modifiedFiles: current.result?.modifiedFiles || [],
          commitHash: current.result?.commitHash || null,
          fileStats: current.result?.changes?.map(c => ({ path: c.path, added: c.added || 0, deleted: c.deleted || 0, isNew: c.isNew })) || [],
          changes: current.result?.changes || [],
        });
        // ★ 协同广播：AI 任务完成
        broadcastChatEvent(projectId, {
          type: 'chat:done',
          conversationId,
          taskId: task.id,
          status: 'completed',
          modifiedFiles: current.result?.modifiedFiles || [],
          commitHash: current.result?.commitHash || null,
        }, userId);
        // 终态：清理 chunk 广播 timer
        if (chatChunkTimer) { clearTimeout(chatChunkTimer); chatChunkTimer = null; }
        try { res.end(); } catch {}
        } else if (current.status === 'failed') {
        clearInterval(pollInterval);
        send({
          type: 'error',
          taskId: task.id,
          conversationId,
          status: 'failed',
          message: current.error || '任务执行失败',
        });
        // ★ 协同广播：AI 任务失败
        broadcastChatEvent(projectId, {
          type: 'chat:error',
          conversationId,
          taskId: task.id,
          status: 'failed',
          message: current.error || '任务执行失败',
        }, userId);
        // 终态：清理 chunk 广播 timer
        if (chatChunkTimer) { clearTimeout(chatChunkTimer); chatChunkTimer = null; }
        try { res.end(); } catch {}
      } else if (current.status === 'cancelled') {
        clearInterval(pollInterval);
        send({
          type: 'cancelled',
          taskId: task.id,
          conversationId,
          status: 'cancelled',
        });
        // ★ 协同广播：AI 任务取消
        broadcastChatEvent(projectId, {
          type: 'chat:cancelled',
          conversationId,
          taskId: task.id,
          status: 'cancelled',
        }, userId);
        // 终态：清理 chunk 广播 timer
        if (chatChunkTimer) { clearTimeout(chatChunkTimer); chatChunkTimer = null; }
        try { res.end(); } catch {}
      }
    }, 500);

    // 安全兜底：30 分钟后强制关闭 SSE（防止泄漏）
    setTimeout(() => {
      if (!clientClosed) {
        clearInterval(pollInterval);
        send({ type: 'error', taskId: task.id, message: 'SSE 连接超时（30 分钟）' });
        try { res.end(); } catch {}
      }
    }, 30 * 60 * 1000);

  } catch (err) {
    console.error('[chat] 任务创建失败:', err);
    send({ type: 'error', message: err.message });
    try { res.end(); } catch {}
  }
});

// ============ 项目初始化（chat 协议版） ============

// 把 initiate 流程包装成 chat 的 SSE 协议
// 事件: task_created -> chunk(多次) -> done/error
// 整个过程作为一条 AI 消息存入会话历史
async function runInitiateChatSSE(req, res) {
  const projectId = req.params.id;
  const userId = req.user?.id || 'anonymous';
  const clientConvId = req.body.conversationId || null;

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientClosed = false;
  res.on('close', () => {
    clientClosed = true;
  });

  const send = (obj) => {
    if (clientClosed) return;
    try {
      res.write('data: ' + JSON.stringify(obj) + '\n\n');
    } catch {}
  };

  // 伪 taskId（initiate 不是走 task 队列，但前端需要 taskId 字段）
  const taskId = 'init_' + Date.now();

  try {
    // 1. 确定会话
    let conversationId = clientConvId;
    if (!conversationId) {
      const conv = await createConversation(projectId, userId, '项目初始化');
      conversationId = conv.id;
      send({ type: 'conversation_created', conversationId, title: conv.title });
    }

    // 2. 存一条用户消息标记（让会话历史知道这是"项目初始化"）
    await addUserMessage(conversationId, '开始生成项目', userId);

    // 3. 预创建 AI 占位消息
    const aiMessageId = await addAiMessage(conversationId, taskId);

    // 4. 通知前端任务已创建
    send({
      type: 'task_created',
      taskId,
      conversationId,
      status: 'running',
      targetFiles: [],
    });

    // 5. 跑 initiate 流程，流式推送 chunk
    let fullOutput = '';
    let initResult = null; // ★ 接收 onDone 的结果，供步骤 6 使用
    await runInitiateViaChat(projectId, {
      onChunk: (chunk) => {
        fullOutput += chunk;
        send({ type: 'chunk', taskId, content: chunk });
      },
      onDone: (result) => {
        initResult = result;
        // 更新 AI 消息为完成
        updateAiMessage(aiMessageId, {
          status: 'completed',
          content: fullOutput,
          modifiedFiles: result?.modifiedFiles || [],
        }).catch(() => {});
      },
      onError: (err, partialOutput) => {
        updateAiMessage(aiMessageId, {
          status: 'failed',
          content: partialOutput || fullOutput,
        }).catch(() => {});
      },
    });

    // 6. 推送完成事件（★ ③附带 openFile 让前端自动打开 doc/PLAN/index.md；★ awaitChoice 让前端显示选择按钮）
    send({ type: 'done', taskId, conversationId, status: 'completed', openFile: 'doc/PLAN/index.md', awaitChoice: initResult?.awaitChoice === true });
    try { res.end(); } catch {}
  } catch (err) {
    console.error('[initiate-chat] error:', err);
    send({ type: 'error', taskId, message: err.message });
    try { res.end(); } catch {}
  }
}

// ============ 按计划生成代码（execute-plan SSE） ============

async function runExecutePlanSSE(req, res) {
  const projectId = req.params.id;
  const userId = req.user?.id || 'anonymous';
  const clientConvId = req.body.conversationId || null;
  const moduleFile = req.body.moduleFile || null; // 指定单个模块文件名，null=全部

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientClosed = false;
  res.on('close', () => { clientClosed = true; });

  const send = (obj) => {
    if (clientClosed) return;
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch {}
  };

  const taskId = 'exec_' + Date.now();

  try {
    // 1. 确定会话
    let conversationId = clientConvId;
    if (!conversationId) {
      const conv = await createConversation(projectId, userId, '按计划生成代码');
      conversationId = conv.id;
      send({ type: 'conversation_created', conversationId, title: conv.title });
    }

    // 2. 存用户消息
    await addUserMessage(conversationId, '按计划生成代码', userId);

    // 3. 预创建 AI 占位消息
    const aiMessageId = await addAiMessage(conversationId, taskId);

    // 4. 通知前端任务已创建
    send({ type: 'task_created', taskId, conversationId, status: 'running', targetFiles: [] });

    // 5. 跑 execute-plan 流程
    let fullOutput = '';
    await runExecutePlan(projectId, {
      moduleFile,
      onChunk: (chunk) => {
        fullOutput += chunk;
        send({ type: 'chunk', taskId, content: chunk });
      },
      onDone: (result) => {
        updateAiMessage(aiMessageId, {
          status: 'completed',
          content: fullOutput,
          modifiedFiles: result?.modifiedFiles || [],
        }).catch(() => {});
      },
      onError: (err, partialOutput) => {
        updateAiMessage(aiMessageId, {
          status: 'failed',
          content: partialOutput || fullOutput,
        }).catch(() => {});
      },
    });

    // 6. 推送完成事件
    send({ type: 'done', taskId, conversationId, status: 'completed' });
    try { res.end(); } catch {}
  } catch (err) {
    console.error('[execute-plan-chat] error:', err);
    send({ type: 'error', taskId, message: err.message });
    try { res.end(); } catch {}
  }
}

// 获取项目的 PLAN 模块列表（供前端 /execute-plan 命令弹窗用）
router.get('/:id/plan-modules', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
    if (!rows[0] || !rows[0].source_path) {
      return res.json({ modules: [] });
    }
    const modules = listPlanModules(rows[0].source_path);
    res.json({ modules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 会话管理 ============

// 获取项目所有会话
router.get('/:id/conversations', async (req, res) => {
  try {
    const list = await getConversations(req.params.id);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建新会话
router.post('/:id/conversations', async (req, res) => {
  try {
    const { title } = req.body || {};
    const conv = await createConversation(req.params.id, req.user?.id, title);
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取会话详情（含所有消息）
router.get('/:id/conversations/:convId', async (req, res) => {
  try {
    const conv = await getConversation(req.params.id, req.params.convId);
    if (!conv) return res.status(404).json({ error: '会话不存在' });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重命名会话
router.put('/:id/conversations/:convId', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: '标题必填' });
    const ok = await renameConversation(req.params.id, req.params.convId, title);
    if (!ok) return res.status(404).json({ error: '会话不存在' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除会话（级联删除消息）
router.delete('/:id/conversations/:convId', async (req, res) => {
  try {
    const ok = await deleteConversation(req.params.id, req.params.convId);
    if (!ok) return res.status(404).json({ error: '会话不存在' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ★ Fork 会话：从指定消息处分叉
router.post('/:id/conversations/:convId/fork', async (req, res) => {
  try {
    const { forkMessageId } = req.body;
    if (!forkMessageId) return res.status(400).json({ error: '缺少 forkMessageId' });
    const result = await forkConversation(req.params.id, req.params.convId, forkMessageId, req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ★ 代码库索引
router.post('/:id/codebase-index/build', async (req, res) => {
  try {
    const result = await buildCodebaseIndex(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/codebase-index/status', async (req, res) => {
  try {
    const status = await getIndexStatus(req.params.id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/codebase-index/search', async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: '缺少搜索关键词 q' });
    const results = await searchCodebase(req.params.id, q, parseInt(limit) || 10);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取项目所有对话任务状态
router.get('/:id/chat/tasks', async (req, res) => {
  try {
    const tasks = getProjectTasks(req.params.id);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取单个任务状态
router.get('/:id/chat/tasks/:taskId', async (req, res) => {
  try {
    const task = getTask(req.params.id, req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取消任务
router.post('/:id/chat/tasks/:taskId/cancel', async (req, res) => {
  try {
    const ok = await cancelTask(req.params.id, req.params.taskId);
    if (!ok) return res.status(404).json({ error: '任务不存在或已终态' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ★ P1-1 审批模式：批准/拒绝工具调用
router.post('/:id/chat/tasks/:taskId/approve', async (req, res) => {
  try {
    const { approvalId, decision, autoApprove } = req.body; // decision: 'approved' | 'rejected', autoApprove: boolean
    if (!approvalId || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: '参数错误：需要 approvalId 和 decision' });
    }
    const ok = approveToolCall(req.params.id, req.params.taskId, approvalId, decision, !!autoApprove);
    if (!ok) return res.status(404).json({ error: '审批请求不存在或已过期' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 回退到某次 AI 修改之前（按 commitHash）
router.post('/:id/chat/rollback/:commitHash', async (req, res) => {
  try {
    const result = await rollbackTask(req.params.id, req.params.commitHash);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ★ SSE 订阅任务事件流（刷新重连 / 多人协同）
// 任何客户端都能订阅正在运行的任务，先 replay 已有 output，再实时推后续事件
router.get('/:id/chat/tasks/:taskId/stream', async (req, res) => {
  const { id: projectId, taskId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // ★ P0：SSE id = 任务内单调递增 seq（事件源在 task.emitter 包装里分配），浏览器自动记住 → 重连带 Last-Event-ID
  const send = (obj) => {
    try { res.write(`id: ${obj.seq || ''}\ndata: ${JSON.stringify(obj)}\n\n`); } catch {}
  };

  // ★ P0：先续传 Redis 事件流（浏览器 Last-Event-ID 之后的未消费事件，断线重连/刷新重放）
  // 事件源唯一（task.emitter.emit 包装 XADD），多客户端各自重放不重复
  const lastEventId = Number(req.headers['last-event-id']) || 0;
  let historical = [];
  try {
    historical = await readTaskEvents(taskId);
  } catch {}
  const pending = historical.filter(({ payload }) => (payload.seq || 0) > lastEventId);
  for (const { payload } of pending) send(payload);
  const lastPayload = pending.length ? pending[pending.length - 1].payload : null;
  // 历史已含终态（任务已完成/失败）→ 无需实时订阅
  if (lastPayload && (lastPayload.type === 'done' || lastPayload.type === 'error')) {
    try { res.end(); } catch {}
    return;
  }
  // ★ P1：历史无终态但 DB 已是终态（worker 已落库/流缺终态/流已过期）→ 立即收尾，不等空转超时
  try {
    const m0 = await getAiMessageByTaskId(taskId);
    if (m0 && (m0.status === 'completed' || m0.status === 'failed' || m0.status === 'cancelled')) {
      if (m0.status === 'completed') send({ type: 'done', taskId, status: 'completed', result: m0.content, seq: (lastPayload?.seq || 0) + 1 });
      else if (m0.status === 'failed') send({ type: 'error', taskId, error: m0.error || '任务失败', seq: (lastPayload?.seq || 0) + 1 });
      else send({ type: 'done', taskId, status: 'cancelled', seq: (lastPayload?.seq || 0) + 1 });
      try { res.end(); } catch {}
      return;
    }
  } catch {}

  let clientClosed = false;
  res.on('close', () => { clientClosed = true; });

  // ★ P1：实时事件源 = Redis Stream XREAD BLOCK（无状态轮询），不依赖 server 内存任务对象。
  // 事件源：dsh 链与审批事件经 server emitter / Pod 内桥包装 XADD（server 重启/崩溃时生成不断、事件不丢）。
  const TASK_MAX_MS = 15 * 60 * 1000; // 与 TASK_TIMEOUT 一致
  const startedAt = Date.now();
  let idleDeadline = Date.now() + 180_000; // 无任何事件 180s → 判定中断（兜底收尾）；有事件即重置
  let cursor = '$';
  let llmFinished = false;
  let awaitingApproval = false; // 审批等待期间不禁用空转兜底（用户思考时间可能很长）

  try {
    while (!clientClosed && Date.now() - startedAt < TASK_MAX_MS) {
      const { entries, cursor: newCursor } = await readTaskEventsLive(taskId, cursor, 5000);
      if (!entries.length) {
        if (llmFinished && Date.now() > idleDeadline) break; // LLM 结束但 server 终态未到 → DB 兜底
        if (!awaitingApproval && Date.now() > idleDeadline) {
          // 长时间无事件（dsh 链 server 挂 / Pod 桥死亡）→ 查 DB 判定中断
          try {
            const msg = await getAiMessageByTaskId(taskId);
            if (!msg || msg.status === 'pending' || msg.status === 'running') {
              await updateAiMessageByTaskId(taskId, { status: 'failed', error: '任务连接中断，请重试' });
              send({ type: 'error', taskId, error: '任务连接中断，请重试', seq: 0 });
              clientClosed = true;
              break;
            }
            break; // DB 已有终态（worker 已落库）→ 正常收尾
          } catch {
            idleDeadline = Date.now() + 30_000; // DB 也异常，稍后再试
          }
        }
        continue;
      }
      cursor = newCursor;
      idleDeadline = Date.now() + 180_000; // 任何事件到达即重置空转计时
      for (const { payload } of entries) {
        const seq = payload?.seq ?? 0;
        if (payload.type === 'chunk') {
          send({ type: 'chunk', taskId, content: payload.content, seq });
        } else if (payload.type === 'tool_event') {
          send({ type: 'tool_event', taskId, ...payload, seq });
          if (payload.approvalId) {
            awaitingApproval = true; // 审批等待：不受空转超时影响
          } else {
            awaitingApproval = false;
          }
        } else if (payload.type === 'stream_end') {
          // LLM 循环完成（dsh 链）→ 落库兜底（幂等），继续等 server 的 done（编译验证/合并）
          llmFinished = true;
          idleDeadline = Date.now() + 60_000;
          if (payload.cancelled) {
            try { await updateAiMessageByTaskId(taskId, { status: 'cancelled' }); } catch {}
            send({ type: 'done', taskId, status: 'cancelled', seq });
            clientClosed = true;
            break;
          }
          try { await updateAiMessageByTaskId(taskId, { status: 'completed', content: payload.content }); } catch {}
          send({ type: 'stream_end', taskId, seq });
        } else if (payload.type === 'stream_error') {
          // dsh 链 LLM 循环异常 → 落库 failed + 结束
          try { await updateAiMessageByTaskId(taskId, { status: 'failed', error: payload.error }); } catch {}
          send({ type: 'error', taskId, error: payload.error, seq });
          clientClosed = true;
          break;
        } else if (payload.type === 'done' || payload.type === 'error') {
          // server 侧 emit 的终态（编译验证/合并完成 / dsh 完成）→ 落库兜底 + 结束
          try {
            await updateAiMessageByTaskId(taskId, {
              status: payload.type === 'error' ? 'failed' : (payload.status || 'completed'),
              content: payload.result ?? payload.content,
              error: payload.error,
            });
          } catch {}
          send({
            type: payload.type,
            taskId,
            status: payload.status || (payload.type === 'error' ? 'failed' : 'completed'),
            result: payload.result ?? null,
            error: payload.error ?? null,
            modifiedFiles: payload.modifiedFiles || [],
            commitHash: payload.commitHash || null,
            changes: payload.changes || [],
            seq,
          });
          clientClosed = true;
          break;
        }
      }
    }
  } catch { /* Redis 异常，走 DB 兜底收尾 */ }

  if (!clientClosed) {
    // 兜底收尾：从 DB 读最终状态（worker 已完成落库），补发终态事件
    try {
      const msg = await getAiMessageByTaskId(taskId);
      if (msg && msg.status === 'completed') {
        send({ type: 'done', taskId, status: 'completed', result: msg.content });
      } else if (msg && msg.status === 'failed') {
        send({ type: 'error', taskId, error: msg.error || '任务失败' });
      } else {
        send({ type: 'error', taskId, message: '连接中断，任务状态未知，请重试' });
      }
    } catch {
      send({ type: 'error', taskId, message: '连接中断，任务状态未知，请重试' });
    }
    try { res.end(); } catch {}
  }
});

// 版本历史
router.get('/:id/history', async (req, res) => {
  try {
    const history = await getHistory(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 版本 diff
router.get('/:id/history/:hash/diff', async (req, res) => {
  try {
    const changes = await getCommitDiff(req.params.id, req.params.hash);
    res.json({ diff: '', changes });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 回滚到指定版本
router.post('/:id/history/:hash/rollback', async (req, res) => {
  try {
    const result = await rollbackToCommit(req.params.id, req.params.hash);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ★ Inline Edit (Cmd+K) - 流式生成代码替换
router.post('/:id/inline-edit', async (req, res) => {
  try {
    const { filePath, selectedText, instruction, language } = req.body;
    if (!filePath || !selectedText || !instruction) {
      return res.status(400).json({ error: 'filePath, selectedText, instruction 不能为空' });
    }
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.id]);
    if (!rows[0]?.source_path) return res.status(404).json({ error: '项目未初始化' });

    // SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const systemPrompt = `你是一个代码编辑助手。用户选中了一段代码，并给出了修改指令。
请直接输出修改后的完整代码，不要用 markdown 代码块包裹，不要解释。
只输出代码本身，保持原有缩进和风格。

文件: ${filePath}
语言: ${language || 'auto'}

选中的代码:
\`\`\`
${selectedText}
\`\`\`

修改指令: ${instruction}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: instruction },
    ];

    const sendChunk = (text) => res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);

    await chatStream(messages, sendChunk, { temperature: 0.2 });

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Inline edit error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
