// dsh-web 反代：平台 server 同域暴露官方 DSH Web UI（工作区 iframe 内嵌）
// ★ 路由反转（2026-08-24）：弃「枚举 dsh RPC 前缀」旧法（每新增 RPC 就 404：
//   commands/skill./interaction./messageFeedback 均踩过），改为——
//   平台 API 家族白名单先行命中 → next() 交平台路由；
//   其余 /api/* 一律视为 dsh RPC fall-through 反代（未来新增 RPC 零配置自动通）。
//   非 /api 顶层挂载（/dsh-web /plugins /assets /socket.io /git …）是官方固定路径，不增长。
// 路径设计：
//   /dsh-web/*    → web pod /*（页面，pathRewrite 剥前缀）
//   /plugins/* /assets/* → web pod（官方 UI 绝对路径静态资源）
//   /socket.io/*  → web pod /socket.io/*（socket.io 握手 HTTP+WS）
//   /api/*（非平台家族）→ web pod（dsh JSON-RPC，登录门默认全开）
// 说明：官方 dsh web 强制绑 127.0.0.1（安全），pod 内由 sidecar nginx 转发到 0.0.0.0:3080。
// changeOrigin 保持 false：保留平台域 Host（<YOUR-DOMAIN>），匹配 --trusted-host fence。
import httpProxy from 'http-proxy';
import { gunzip } from 'zlib';
import { verifyToken } from '../middleware/auth.js';
import { getProjectRole } from '../middleware/permission.js';
import { canUserReadSession, userProjectSet, workspaceProjectId, sessionProjectId } from './session-access.js';
import { db } from '../db/init.js';
import { bumpAccessMap } from './access-map-events.js';

const TARGET = process.env.DSH_WEB_URL || 'http://madazi-dsh-web:3080';

// ★ 平台 API 家族（有限且稳定）——必须与 pod 侧 nginx 白名单正则镜像同步
//   （k8s/dsh-web-deployment.yaml：^/api/(auth/|keys/|admin/|market/|projects/|dsh/|llm/|templates/|skills/|license/|ws/)）
//   ⚠️ 两表不同步 = server↔pod 代理环路（pod 把 /api/<家族>/ 回流 server，server 又转回 pod）
//   ⚠️ ws/ 无平台 HTTP 路由但必须认领（preview-log WS 走 upgrade 直达；HTTP 侧认领防环路）
//   ⚠️ health 精确匹配（licenseGate 放行依赖）
//   ⚠️ skills 家族用负向前瞻排除 /api/skills/list —— 那是 dsh 技能目录 RPC（skills namespace
//     唯一方法 list），非平台 API；平台 skills API（GET /mine、/install、/:id 等）仍走 server。
//   ⚠️ llm 家族同样负向前瞻排除 dsh 的 llm RPC（listProviders/discoverModels/
//     listConfigurableProviders/adapters 四方法，模型设置 tab 消费）；平台 llm API
//     （configs/presets）仍走 server。
//   ⚠️ session/ 不在此认领（2026-09-04）：/api/session/* 落入下方 /api/ 分支，
//     由 SESSION_RPC/LIST/CREATE（斜杠兼容）精确拦截敏感 RPC，非敏感（modelCatalog 等）反代 dsh。
//     认领进 PLATFORM_API 反而会让非敏感 session RPC 404（server 无对应端点）。
const PLATFORM_API = /^\/api\/(health$|auth(?:\/|$)|keys(?:\/|$)|admin(?:\/|$)|market(?:\/|$)|projects(?:\/|$)|dsh(?:\/|$)|llm(?!\/(?:listProviders|discoverModels|listConfigurableProviders|adapters)(?:\/|$))(?:\/|$)|templates(?:\/|$)|license(?:\/|$)|ws(?:\/|$)|skills(?!\/list(?:\/|$))(?:\/|$))/;

// dsh 静态资源（未登录可访问：登录页/工作台壳必须能加载；纯静态无数据）
const DSH_PUBLIC = [
  /^\/dsh-web(\/|$)/, // 官方 UI 骨架 + assets + plugins + profile.json（统一放行）
  /^\/plugins(\/|$)/, // pathRewrite 后官方 UI 绝对路径引用形态
  /^\/assets(\/|$)/,
  /^\/favicon/,
  /^\/manifest\.webmanifest$/, // PWA manifest（浏览器自动拉取；3080 有、3456 反代漏 → 404）
];

// dsh 数据面顶层挂载（官方固定路径，需登录；不随 RPC 增长）
const DSH_AUTH_TOP = ['/socket.io', '/git', '/workbench-sounds', '/ultra-slash', '/open-in-app'];

// 从 URI/URL 字符串的 query 里取 token（无 ? 或无 token → null）
function queryToken(str) {
  const qi = String(str).indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(String(str).slice(qi + 1)).get('token');
}

// cookie/header/query 三通道取 token（与平台 auth 中间件同语义）
// 注：WS upgrade 是原生 http.IncomingMessage，无 express 解析的 req.query —— 从 req.url 手工解析
function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  // ★ P3：Traefik forwardAuth 不透传 query，原始 URI（含 query）在 X-Forwarded-Uri 头
  const xfu = req.headers['x-forwarded-uri'];
  if (xfu) {
    const t = queryToken(xfu);
    if (t) return t;
  }
  const t = queryToken(req.url || '');
  if (t) return t;
  if (req.query && req.query.token) return req.query.token;
  const cookieHeader = req.headers.cookie || '';
  const m = cookieHeader.match(/(?:^|;\s*)madazi_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

function isAuthed(req) {
  const token = extractToken(req);
  if (!token) return false;
  return !!(verifyToken(token) && verifyToken(token).id);
}

// dsh web 特权 RPC（settings.*/credentials.*/agentPreset.*/host.pickDirectory/openPath/llm.discoverModels）
// 官方硬编码 loopback-only（isTrustedApiRequest(request, [])），公网反代 Host=<YOUR-DOMAIN> 必 403。
// 平台登录门（/api/* 默认全鉴权）已挡未认证调用，这里伪装 loopback + 删 Origin 等价放行。
const PRIVILEGED_RPC = /^\/api\/(settings\.|credentials\.|agentPreset\.|host\.pickDirectory|host\.openPath|llm\.|pluginInventory)/;

// ★ 会话数据层权限（2026-08-27）：dsh 共享单实例会话全局可见，网关拦截敏感会话 RPC——
//   读消息（history）/发消息（prompt）/导出（export）/子代理（subagent.history）
//   + 操作已有会话（fork/rename/attachment/selectModel/cancel/updateQueue）→ 按 sessionId 校验
// ★ 2026-09-04 适配 0.1.2 RPC 形态：dsh 0.1.2 起 RPC 用斜杠分隔（/api/session/prompt、/api/session/list），
//   旧版本用点号（/api/session.prompt）。两形态都匹配，防版本漂移漏拦。
//   读消息（history）/发消息（prompt）/导出（export）/子代理（subagent.history）
//   + 操作已有会话（fork/rename/attachment/selectModel/cancel/updateQueue）→ 按 sessionId 校验
const SESSION_RPC = /^\/api\/(session[./](history|prompt|export|fork|rename|attachment|selectModel|cancel|updateQueue)|subagent[./]history)$/;
// 会话列表/搜索/@候选：请求转发后按 cwd 过滤非成员项目会话（响应过滤）。
// ★ sessionReferenceResolver.candidates 并入（2026-09-05）：@会话候选走官方 RPC
//   全量下发，此前只在 host 侧按「发起会话归属者」过滤——共享会话场景（user2 在 admin
//   会话里 @）会继承归属者权限 → 泄露 admin 权限内会话。这里按 cookie 当前用户（me）
//   过滤，与 sidebar 会话列表同口径；host 侧过滤保留为纵深（安全叠加不放宽）。
const SESSION_LIST_RPC = /^\/api\/(session[./](list|search)|sessionReferenceResolver[./]candidates)$/;
// 会话创建：按 payload.cwd / workspaceId 归属项目校验（非成员不得在他人项目建会话）
const SESSION_CREATE_RPC = /^\/api\/session[./]create$/;
// 发消息 RPC：仅 server 侧发送人记录用（斜杠/点号兼容）
const SESSION_PROMPT_RPC = /^\/api\/session[./]prompt$/;

// ★ 谁发消息谁控制浏览器（2026-09-04）：session/prompt 是所有发消息路径（输入框回车/
//   AI 快捷选择/未来任何入口）的唯一服务端汇聚点，cookie 身份权威识别发起者 → 推送
//   dsh host（fire-and-forget，不阻塞 prompt 转发）。host 在该会话本轮首个浏览器指令时
//   解析发起者（userId）的心跳窗口并锁定整轮：指令/呼吸层/接管按钮只落在发起者窗口，
//   AI 只读发起者窗口的浏览器结果；其他人的窗口收不到任何指令（只看会话消息流）。
//   替代已废弃的浏览器侧 pointerdown/keydown 交互启发式（旁观点击会偷走发起者身份）。
const notifyBrowserInitiator = (sessionId, userId) => {
  if (!sessionId || !userId) return;
  try {
    fetch(`${TARGET}/git/browser-initiator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch (e) { /* fire-and-forget：失败不影响发消息 */ }
};

function userFromReq(req) {
  const token = extractToken(req);
  if (!token) return null;
  const p = verifyToken(token);
  return p && p.id ? { id: p.id, username: p.username || '' } : null;
}

// 收集请求体（dsh RPC 走 fetch 信封，body 含 payload.sessionId）
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 拦截会话数据 RPC：解析 sessionId → 校验用户成员 → 非成员 403
async function handleSessionRPC(req, res, proxy, filterProxy) {
  const me = userFromReq(req);
  if (!me) return res.status(401).json({ error: '未登录' });
  // ★ 诊断（2026-09-05）：确认 candidates/list 是否真的经过网关过滤分支
  console.log(`[ref-filter] sessionRPC path=${req.path} list=${SESSION_LIST_RPC.test(req.path)} user=${me.username}`);
  let sessionId = null;
  let isList = false;
  if (req.method === 'GET') {
    // session.export?sessionId=
    try { sessionId = new URL(req.url, 'http://x').searchParams.get('sessionId'); } catch { sessionId = null; }
    // ★ 纵深防御：GET 形态的 session.list/search 同样要过成员过滤
    //   （否则该路径会整体绕过服务端会话隔离，只靠客户端 membership gate 兜底）
    isList = SESSION_LIST_RPC.test(req.path);
  } else {
    let raw = Buffer.alloc(0);
    try { raw = await readBody(req); } catch { raw = Buffer.alloc(0); }
    req._dshRawBody = raw; // 供 proxyReq 回写
    let body = null;
    try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { body = null; }
    const payload = (body && body.payload) || {};
    // ★ 0.1.2 会话 RPC 信封：payload.args.request 内嵌 sessionId/content（探针实测），
    //   老版本点分 RPC 用 payload.sessionId 平铺——两形态都兼容
    const reqArgs = (payload.args && payload.args.request) || {};
    sessionId = reqArgs.sessionId || payload.sessionId || payload.childSessionId || null;
    isList = SESSION_LIST_RPC.test(req.path);
  }
  if (sessionId) {
    const chk = await canUserReadSession(me.id, sessionId);
    if (!chk.ok) {
      console.warn(`[session-access] DENIED user=${me.username} sid=${String(sessionId).slice(0, 12)}… pid=${(chk.projectId || '').slice(0, 8)}`);
      return res.status(403).json({ error: '无权访问该会话' });
    }
    // ★ 2026-09-05 活跃操作者（权限根主体）：会话操作者可能是项目成员而非归属者
    //   （共享会话场景），clamp 权限根必须跟随「最近操作者」而非「归属者」，
    //   否则 user2 打开 admin 的会话就继承 admin 全部项目权限（越权写他人项目）。
    //   排除 list/search（高频轮询，不产生操作者语义）；变更即推送映射刷新。
    if (!isList) {
      db.query('UPDATE dsh_session_owners SET active_user_id = $1 WHERE session_id = $2', [me.id, sessionId])
        .then((r) => { if (r.rowCount > 0) bumpAccessMap(); })
        .catch(() => {});
    }
    // ★ 2026-09-04 发送人记录（server 侧权威）：0.1.2 的 RPC 传输持有模块级 fetch，
    //   客户端 window.fetch 拦截失效（dsh_message_senders 一直 0 行 → 气泡署名无数据）。
    //   改在网关统一记录 session/prompt（发消息）→ 发送人 + 文本前缀入库，供署名渲染。
    if (SESSION_PROMPT_RPC.test(req.path)) {
      try {
        const body = JSON.parse((req._dshRawBody || Buffer.alloc(0)).toString('utf8') || '{}');
        const rpcId = typeof body.rpcId === 'string' ? body.rpcId : '';
        const pl = (body && body.payload) || {};
        // ★ 0.1.2 信封：payload.args.request 内嵌 sessionId/content（探针实测）；老版本平铺 payload.*
        const reqArgs = (pl.args && pl.args.request) || {};
        const sid = reqArgs.sessionId || pl.sessionId || '';
        // ★ 发起者权威上报（不依赖 rpcId/文本提取成败——快捷选择/输入框/任何入口都过这里）
        notifyBrowserInitiator(sid, me.id);
        const content = Array.isArray(reqArgs.content) ? reqArgs.content : (Array.isArray(pl.content) ? pl.content : []);
        const text = content.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 40);
        console.log(`[sender-record] path=${req.path} rpcId=${rpcId} sid=${sid} text=${text} hasBody=${!!req._dshRawBody}`);
        if (rpcId && sid && text) {
          const pid = await sessionProjectId(sid);
          console.log(`[sender-record] pid=${pid}`);
          if (pid) {
            await db.query(
              `INSERT INTO dsh_message_senders (rpc_id, session_id, project_id, user_id, text_prefix)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (rpc_id) DO NOTHING`,
              [rpcId, sid, pid, me.id, text]
            );
            console.log(`[sender-record] INSERTED sid=${sid}`);
          }
        }
      } catch (e) { console.log('[sender-record] ERR', String(e && e.message || e)); }
    }
  }
  // ★ session.create：非成员不得在他人项目创建会话（按 payload.cwd / workspaceId 归属校验）
  if (SESSION_CREATE_RPC.test(req.path)) {
    let body = null;
    try { body = JSON.parse((req._dshRawBody || Buffer.alloc(0)).toString('utf8') || '{}'); } catch { body = null; }
    const payload = (body && body.payload) || {};
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
    const wid = typeof payload.workspaceId === 'string' ? payload.workspaceId : '';
    let cProjectId = cwd ? ((cwd.match(/\/generated\/([0-9a-fA-F-]{36})/) || [])[1] || null) : null;
    if (!cProjectId && wid) cProjectId = workspaceProjectId(wid);
    if (cProjectId) {
      const role = await getProjectRole(me.id, cProjectId);
      if (!role) {
        console.warn(`[session-access] DENIED create user=${me.username} pid=${cProjectId.slice(0, 8)}`);
        return res.status(403).json({ error: '无权在该项目创建会话' });
      }
    }
    return proxy.web(req, res, { target: TARGET, changeOrigin: false });
  }
  if (isList) {
    req._filterSessions = true; // proxyRes 按 cwd 过滤非成员项目会话
    return filterProxy.web(req, res, { target: TARGET, changeOrigin: false });
  }
  proxy.web(req, res, { target: TARGET, changeOrigin: false });
}

// ★ 会话列表/搜索响应过滤：selfHandleResponse 手动写回（按 cwd 归属项目 ∩ 用户项目集合）
function setupSessionFilterProxy() {
  const fp = httpProxy.createProxyServer({ selfHandleResponse: true });
  // ★ 2026-09-08 崩溃根因修复：http-proxy 无 error listener 时连接失败会直接 throw，崩掉整个 server。
  //   dsh-web 任何抖动（rollout / 未就绪 / 网络闪断）→ 此前 server 进程崩溃 → 全站 502、WS 断连
  //   （症状：remote.mux / /git/* / SSE 全线断，K8s 自动重启后恢复 = 「偶尔断线」）。
  fp.on('error', (err, req, res) => {
    if (res && typeof res.status === 'function' && !res.headersSent) {
      res.status(502).json({ error: 'dsh-web 不可用（web pod 未就绪？）' });
    } else if (res && typeof res.destroy === 'function') {
      res.destroy();
    } else {
      console.error('[dsh-web] filterProxy error:', err && err.message);
    }
  });
  fp.on('proxyReq', (proxyReq, req) => {
    let path = req.originalUrl || req.url;
    if (path.startsWith('/dsh-web')) path = path.slice('/dsh-web'.length) || '/';
    proxyReq.path = path;
    if (req._dshRawBody && req._dshRawBody.length) {
      proxyReq.setHeader('Content-Length', req._dshRawBody.length);
      proxyReq.write(req._dshRawBody);
    }
  });
  fp.on('proxyRes', (proxyRes, req, res) => {
    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      const buf = Buffer.concat(chunks);
      const flush = (out) => {
        try {
          res.statusCode = proxyRes.statusCode || 200;
          res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json');
          res.setHeader('Content-Length', Buffer.byteLength(out));
          res.write(out);
          res.end();
        } catch { /* ignore */ }
      };
      // ★ 2026-09-04 解压 gzip：dsh-web nginx 对 JSON 响应 gzip（gzip_proxied any），
      //   selfHandleResponse 原样转发会丢 content-encoding 头 → 浏览器拿到 gzip 字节当文本 → 乱码
      //   （症状：session/list 200 但 body 乱码、会话列表空）。这里显式解压后以纯 JSON 输出。
      const encoding = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
      const decode = (b) => new Promise((resolve) => {
        if (!encoding.includes('gzip')) return resolve(b);
        gunzip(b, (err, out) => resolve(err ? b : out));
      });
      decode(buf).then((rawBuf) => {
        const raw = rawBuf.toString('utf8');
        if (!req._filterSessions) return flush(raw);
        (async () => {
          try {
            const me = userFromReq(req);
            const pset = me ? await userProjectSet(me.id) : new Set();
            const json = JSON.parse(raw);
            // ★ 兼容两种响应形状：value.items（session.list/search 实际形状）与
            //   value 直接数组（旧假设）。形状不匹配时此前整段过滤静默失效。
            const value = json && json.result ? json.result.value : null;
            const list = Array.isArray(value) ? value
              : (value && Array.isArray(value.items) ? value.items : null);
            if (list) {
              // ★ 2026-09-04 归属反写（server 侧权威）：dsh 0.1.2 客户端模块级 fetch 绕过
              //   window.fetch 上报，dsh_session_owners 长期 0 行 → sessionProjectId 解析不到。
              //   会话列表响应自带 cwd → 项目，这里顺手把「sessionId→projectId」反写进
              //   dsh_session_owners，供 prompt 发送人记录与权限校验兜底（先到先得不覆盖）。
              if (me) {
                for (const row of list) {
                  const cwd = row && row.cwd ? String(row.cwd) : '';
                  const m = cwd.match(/generated\/([0-9a-fA-F-]{36})/);
                  if (m && row.sessionId) {
                    try {
                      const r = await db.query(
                        `INSERT INTO dsh_session_owners (session_id, project_id, user_id)
                         VALUES ($1, $2, $3) ON CONFLICT (session_id) DO NOTHING`,
                        [row.sessionId, m[1], me.id]
                      );
                      if (r.rowCount > 0) bumpAccessMap(); // 新归属反写 → 推送权限映射变更
                    } catch { /* 归属反写失败不阻断列表 */ }
                  }
                }
              }
              const filtered = list.filter((row) => {
                const cwd = row && row.cwd ? String(row.cwd) : '';
                const m = cwd.match(/generated\/([0-9a-fA-F-]{36})/);
                if (!m) return true; // 无归属会话（普通 workspace）：保留
                return pset.has(m[1]); // 非成员项目会话过滤掉
              });
              if (Array.isArray(value)) json.result.value = filtered;
              else value.items = filtered;
              flush(JSON.stringify(json));
            } else {
              flush(raw);
            }
          } catch { flush(raw); }
        })();
      });
    });
  });
  return fp;
}

// ★ P3（2026-08-24）：Traefik forwardAuth 鉴权探针。
//   入口层接管 dsh 数据面分流后，登录门 = Traefik 每 request 调本端点（2xx=放行）。
//   判定语义与本文件 isAuthed 完全同源（extractToken 三通道 + X-Forwarded-Uri）。
//   ⚠️ 挂载必须在 licenseGate 之前：dsh 反代路径今天不过 licenseGate（中间件时序在 gate 前），
//   若 auth/check 被门禁拦截，license 失效时 dsh 会被连坐（行为回归）。
//   必须收任意 method：forwardAuth 按原始请求 method 转发（POST RPC → POST auth/check）。
export function registerAuthCheck(app) {
  app.all('/api/auth/check', (req, res) => {
    if (isAuthed(req)) return res.status(200).json({ ok: true });
    res.status(401).json({ error: '未登录' });
  });
}

export function setupDshWebProxy(app) {
  const proxy = httpProxy.createProxyServer({ ws: true });
  const filterProxy = setupSessionFilterProxy();

  proxy.on('proxyReq', (proxyReq, req) => {
    // 自定义中间件不剥离 req.url，originalUrl 与 url 一致；仅 /dsh-web 前缀需重写
    let path = req.originalUrl || req.url;
    // /dsh-web/* → /*（官方 UI 根路径）
    if (path.startsWith('/dsh-web')) {
      path = path.slice('/dsh-web'.length) || '/';
    }
    proxyReq.path = path;
    // ★ 会话 RPC 的 body 已被 handleSessionRPC 读取消费 → 这里回写（http-proxy 默认 pipe 已无数据）
    if (req._dshRawBody && req._dshRawBody.length) {
      proxyReq.setHeader('Content-Length', req._dshRawBody.length);
      proxyReq.write(req._dshRawBody);
    }
    // ★ 特权 RPC 伪装 loopback：Host → 127.0.0.1 + 删 Origin（绕过 loopback-only 围栏）
    if (PRIVILEGED_RPC.test(path)) {
      proxyReq.setHeader('Host', '127.0.0.1');
      proxyReq.removeHeader('Origin');
    }
  });

  proxy.on('proxyRes', (proxyRes, req, res) => {
    // 调试：记录状态码
    if (process.env.NODE_ENV !== 'production') {
      console.log('[dsh-web]', req.method, req.url, '->', proxyRes.statusCode);
    }
  });

  proxy.on('error', (err, req, res) => {
    console.error('[dsh-web] proxy error:', err.message);
    // HTTP 场景 res 是 express Response；WS 升级失败时 res 是 socket（无 status 方法）
    if (res && typeof res.status === 'function' && !res.headersSent) {
      res.status(502).json({ error: 'dsh-web 不可用（web pod 未就绪？）' });
    } else if (res && typeof res.destroy === 'function') {
      res.destroy();
    }
  });

  // ★ 反转决策（挂载位置不变：express.json 之前，dsh 请求体不经 json 解析器）：
  //   1) 平台 API 家族 → next()（平台路由 + licenseGate 处理）
  //   2) 其余 /api/* → dsh RPC，登录门默认全开（新增 RPC 零配置自动通）
  //   3) dsh 静态顶层 → 放行反代；dsh 数据顶层（socket.io/git/…）→ 登录门后反代
  //   4) 其余未知路径 → next() → 平台 404（不扩大暴露面）
  // 注：不用 app.use(数组) mount 匹配——mount 语义要求「路径等于或带斜杠边界」
  // （/api/host. 匹配不到 /api/host.describe，点分 RPC 全 404）。
  app.use((req, res, next) => {
    const p = req.path;
    if (PLATFORM_API.test(p)) return next();
    if (p.startsWith('/api/')) {
      if (!isAuthed(req)) return res.status(401).json({ error: '未登录' });
      // ★ 会话数据层权限：拦截敏感会话 RPC（读/写/操作/列表 + 创建按归属校验）
      if (SESSION_RPC.test(p) || SESSION_LIST_RPC.test(p) || SESSION_CREATE_RPC.test(p)) {
        return handleSessionRPC(req, res, proxy, filterProxy);
      }
      return proxy.web(req, res, { target: TARGET, changeOrigin: false });
    }
    if (DSH_PUBLIC.some((rx) => rx.test(p))) {
      return proxy.web(req, res, { target: TARGET, changeOrigin: false });
    }
    if (DSH_AUTH_TOP.some((prefix) => p.startsWith(prefix))) {
      if (!isAuthed(req)) return res.status(401).json({ error: '未登录' });
      return proxy.web(req, res, { target: TARGET, changeOrigin: false });
    }
    next();
  });

  // upgrade 处理：凡路由到此的 WS（/ws 原生 + /socket.io + /api/events.*，见 index.js upgrade 分流）
  // 均 dsh 所有。/ws 维持旧版无鉴权行为（官方客户端本地工具语义）；其余默认登录门。
  // 平台项目 WS（/api/projects/*）不经此分支。
  return (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/ws') && !isAuthed(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"error":"未登录"}');
      return socket.destroy();
    }
    proxy.ws(req, socket, head, { target: TARGET, changeOrigin: false });
  };
}
