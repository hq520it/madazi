import { WebSocketServer } from 'ws';
import { verifyToken } from '../middleware/auth.js';
import { db } from '../db/init.js';
import { buildLogStore, appendBuildLog } from './docker-build.js';
import { getProjectRole } from '../middleware/permission.js';
import { initBus, onBus, publish } from './bus.js';

// ★ 短 id（8 位 pv-xxxx 前缀）→ 完整 projectId 解析（同步，多源前缀匹配）。
//   workbench 客户端从预览 URL 提取 pid8 订阅，事件流 buildLogStore 的 key 是
//   完整 UUID；不归一化则 [server] 生命周期事件永远匹配不上。
//   源：启动中项目的事件 key（startPreview 在建 Pod 前就写入）。pod 已 ready
//   且无事件的场景（server 重启后）解析不出也无妨——pid8 拉取 Pod 日志前缀正确。
function resolvePreviewProjectId(shortId) {
  if (!shortId) return null;
  for (const key of buildLogStore.keys()) {
    if (key.startsWith(shortId)) return key;
  }
  return null;
}

/**
 * 项目级 WebSocket 服务
 * URL: /api/projects/:id/ws?token=JWT
 *
 * 一个连接 per 用户 per 项目，负责：
 * - 在线状态广播（presence）
 *
 * 消息格式（JSON）：
 * client -> server: { type: 'ping' }
 * server -> client: { type: 'presence', users: [{id,username}] }
 *                { type: 'pong' }
 */

// projectId -> Set<ws>
const projectConnections = new Map();
// watch 连接：只接收 presence 广播，不参与在线集合（列表页观看者）
const watchConnections = new Map();
// 全局 presence 订阅：一个连接看所有项目在线（sidebar 子行实时在线）
const globalPresenceWatchers = new Set();
// 全局在线集合：userId -> {user_id, username}（登录即在线；退出登录/关页断开即下线）
const globalUsers = new Map();
const globalUserCount = new Map(); // userId -> 连接数（多标签页去重）

// 预览日志流：projectId -> Set<ws>（订阅者）+ 1s 推送 timer + 增量基准
const previewLogWatchers = new Map();
const previewLogTimers = new Map();
const previewLogLast = new Map(); // projectId -> { text }

// ★ P1 多副本 presence 合并视图：
//   本地快照（localSnapshot）+ 远端副本快照（remoteSnapshots，40s 新鲜窗口）。
//   副本 crash → 心跳停止 → 快照过期 → 在线状态自动修正，无需精确清理。
const remoteSnapshots = new Map(); // nodeId -> { snap, ts }
const SNAPSHOT_TTL_MS = 40000;
// 「上一轮广播过的 projectId」：人走光（所有副本都空）也要发空列表清空客户端徽标
let lastPresenceKeys = new Set();

/** 本副本的 presence 快照：全局在线 + 每项目在线（去重用户） */
function localSnapshot() {
  const projects = {};
  for (const [pid, conns] of projectConnections) {
    const seen = new Map();
    for (const ws of conns) {
      if (!seen.has(ws._userId)) seen.set(ws._userId, { id: ws._userId, username: ws._username });
    }
    projects[pid] = Array.from(seen.values());
  }
  const global = [];
  for (const [uid, info] of globalUsers) {
    global.push({ id: uid, username: info.username });
  }
  return { global, projects };
}

/** 合并本地+远端快照 → { global: [{user_id,username}], projects: { pid: [{id,username}] } } */
function mergedViews() {
  const now = Date.now();
  const snaps = [{ snap: localSnapshot(), ts: now }];
  for (const rec of remoteSnapshots.values()) {
    if (now - rec.ts < SNAPSHOT_TTL_MS) snaps.push(rec);
  }
  const g = new Map();
  for (const { snap } of snaps) {
    for (const u of snap.global) {
      if (!g.has(u.id)) g.set(u.id, { user_id: u.id, username: u.username });
    }
  }
  const p = new Map();
  for (const { snap } of snaps) {
    for (const [pid, users] of Object.entries(snap.projects)) {
      if (!p.has(pid)) p.set(pid, new Map());
      const m = p.get(pid);
      for (const u of users) {
        if (!m.has(u.id)) m.set(u.id, { id: u.id, username: u.username });
      }
    }
  }
  return {
    global: Array.from(g.values()),
    projects: Object.fromEntries(Array.from(p, ([k, m]) => [k, Array.from(m.values())])),
  };
}

/** 上报本地快照到总线（本地 fanout + 其他副本镜像），并触发全量 presence 广播 */
function reportPresence() {
  publish({ t: 'presence', snap: localSnapshot() });
}

// ★ 短 id 订阅组迁移到完整 id：订阅先于启动发生时（用户先开 Console 再选项目），
//   连接时刻 buildLogStore 尚无事件 key，归一化失败 → tick 里懒解析，事件 key
//   出现后把 watcher 组迁到完整 key（事件流匹配 + kick 推送都按完整 key 生效）
function migratePreviewLogGroup(shortId, fullId) {
  const watchers = previewLogWatchers.get(shortId);
  if (!watchers || watchers.size === 0) return;
  let target = previewLogWatchers.get(fullId);
  if (!target) { target = new Set(); previewLogWatchers.set(fullId, target); }
  for (const ws of watchers) { ws._projectId = fullId; target.add(ws); }
  const t = previewLogTimers.get(shortId);
  if (t) { clearInterval(t); previewLogTimers.delete(shortId); }
  previewLogWatchers.delete(shortId);
  previewLogLast.delete(shortId);
  if (!previewLogTimers.has(fullId)) {
    const timer = setInterval(() => pushPreviewLogs(fullId), 1000);
    previewLogTimers.set(fullId, timer);
  }
  console.log(`[project-ws] preview-log group migrated ${shortId} -> ${fullId}`);
}

async function pushPreviewLogs(projectId, full = false) {
  // ★ 懒解析：本组是短 id 且事件 key 已出现 → 先迁移再继续（本轮即按完整 key 推）
  if (projectId.length < 32) {
    const fullId = resolvePreviewProjectId(projectId);
    if (fullId) {
      migratePreviewLogGroup(projectId, fullId);
      projectId = fullId;
    }
  }
  const watchers = previewLogWatchers.get(projectId);
  if (!watchers || watchers.size === 0) return;
  try {
    const { getPreviewPodLogs } = await import('./preview-k8s.js');
    // ★ server 侧生命周期事件（启动触发/镜像选择/Pod 创建/就绪）：每行加 [server] 前缀前置合并。
    //   Pod 容器有输出前（K8s 调度/拉镜像空窗期，可能数十秒~分钟）控制台靠这些事件可见进度，
    //   之后与 Pod stdout（entrypoint 构建 → 前后端启动 → 运行时）无缝衔接成完整时间线
    const evEntry = buildLogStore.get(projectId);
    const evText = evEntry?.logs
      ? evEntry.logs.split('\n').filter(Boolean).map(l => `[server] ${l}`).join('\n') + '\n'
      : '';
    // ★ tail 5000：构建段（maven/npm 依赖下载）可能上千行，500 会被截断
    const { logs } = await getPreviewPodLogs(projectId, 5000);
    let podText = logs || '';
    // pod 不存在时的固定提示文本：启动已触发（有事件）时丢弃提示避免误导，仅展示事件流
    if (evText && podText.includes('预览尚未启动')) podText = '';
    const combined = evText + podText;
    const last = previewLogLast.get(projectId);
    let text = '';
    let reset = false;
    if (full || !last) {
      text = combined;
      reset = true;
    } else {
      const prev = last.text || '';
      const prevTail = prev.slice(-200);
      const lines = combined.split('\n');
      // ★ 事件行插在 combined 头部，行级增量假设「prev 是 combined 行前缀」不成立：
      //   prev 无事件 → combined 出现事件（首包推送早于事件产生的典型时序）时，
      //   slice(drop) 会吞掉头部事件行 → 事件行数变化时强制全量 reset
      const evCount = (t) => (t.match(/^\[server\] /gm) || []).length;
      // ★ 连续性检测：新日志不含 prev 尾部 = pod 重建/日志清空 → 全量重置
      if ((evCount(prev) !== evCount(combined)) || (prevTail && !combined.includes(prevTail))) {
        text = combined;
        reset = true;
      } else {
        // 行级增量（prev 末尾无 \n 时丢最后未完成行，避免重复）
        const prevLines = prev.split('\n');
        const drop = prev.endsWith('\n') ? prevLines.length : Math.max(0, prevLines.length - 1);
        text = lines.slice(drop).join('\n');
      }
    }
    previewLogLast.set(projectId, { text: combined });
    if (!text) return;
    for (const ws of watchers) {
      try { send(ws, { type: 'log', projectId, text, reset }); } catch { /* ignore */ }
    }
  } catch (err) {
    // pod 未就绪/无日志：静默，下个 tick 重试
  }
}

// ★ 事件即时触发推送（docker-build pushBuildLog 经总线 fanout 调用）：500ms 节流合并，
//   1s tick 兜底——「🚀 Pod 已启动」等事件不等 tick 立即可见
const previewLogKickAt = new Map();
function kickPreviewLogsLocal(projectId) {
  if (!previewLogWatchers.has(projectId)) return;
  const now = Date.now();
  if (now - (previewLogKickAt.get(projectId) || 0) < 500) return;
  previewLogKickAt.set(projectId, now);
  pushPreviewLogs(projectId).catch(() => {});
}

// ★ P1：kick/reset 走总线（HTTP 请求可能落在任意副本，preview-log watcher 在各副本）
export function kickPreviewLogs(projectId) {
  publish({ t: 'kick', projectId });
}

// ★ stopPreview 时重置增量基线：新一轮启动首包走全量 reset 路径（跨副本）
export function resetPreviewLogBaseline(projectId) {
  publish({ t: 'reset', projectId });
}

function broadcastGlobalPresence() {
  const users = mergedViews().global;
  for (const ws of globalPresenceWatchers) {
    send(ws, { type: 'presence', scope: 'global', users });
  }
}

export function setupProjectWS(server) {
  const wss = new WebSocketServer({ noServer: true });

  // ★ P1 事件总线：跨副本消息统一入口（本地+远端），一次注册
  initBus();
  onBus((msg) => {
    switch (msg.t) {
      case 'presence': {
        remoteSnapshots.set(msg.from, { snap: msg.snap, ts: Date.now() });
        // 快照变化影响所有项目视图 → 全量重广播（含「上一轮有、本轮空」的清空语义）
        const views = mergedViews();
        for (const ws of globalPresenceWatchers) {
          send(ws, { type: 'presence', scope: 'global', users: views.global });
        }
        const keys = new Set([...Object.keys(views.projects), ...lastPresenceKeys]);
        for (const pid of keys) {
          broadcastPresence(pid, views);
        }
        lastPresenceKeys = new Set(Object.keys(views.projects));
        break;
      }
      case 'chat': {
        // 跨副本对话事件：推给本地项目连接（excludeUserId 语义全局一致——同一用户多标签页连在其他副本也不重复显示）
        const conns = projectConnections.get(msg.projectId);
        if (!conns) break;
        for (const ws of conns) {
          if (msg.excludeUserId && ws._userId === msg.excludeUserId) continue;
          send(ws, msg.event);
        }
        break;
      }
      case 'member_added': {
        // ★ 协同实时：项目加了新成员 → 推给该用户的全局 WS 连接（登录即在线，跨副本均扫到），
        //   前端收到后自动创建 workspace + 刷新项目列表（被加进项目立即可见）
        const payload = { type: 'member_added', projectId: msg.projectId, projectName: msg.projectName || '', addedBy: msg.addedBy || '' };
        for (const ws of globalPresenceWatchers) {
          if (ws._userId === msg.userId) send(ws, payload);
        }
        break;
      }
      case 'project_created': {
        // ★ 协同实时：新项目 → 推给所有在线全局 WS（管理员/成员即时看到；可见性由
        //   GET /projects 按权限过滤，广播本身不泄露）
        const payload = { type: 'project_created', projectId: msg.projectId, name: msg.name || '', ownerId: msg.ownerId || '', ownerName: msg.ownerName || '' };
        for (const ws of globalPresenceWatchers) send(ws, payload);
        break;
      }
      case 'kick':
        kickPreviewLogsLocal(msg.projectId);
        break;
      case 'reset':
        previewLogLast.delete(msg.projectId);
        break;
      case 'buildlog':
        appendBuildLog(msg.projectId, msg.line, msg.status);
        kickPreviewLogsLocal(msg.projectId);
        break;
      default:
        break;
    }
  });
  // ★ 心跳上报：15s 刷新本副本快照（兼作 liveness——副本 crash 后 40s 快照过期，在线状态自动修正）
  setInterval(reportPresence, 15000);

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url.includes('/ws')) return; // 让其他 upgrade handler 处理
    const url = new URL(req.url, 'http://localhost');
    // token 优先 query（旧客户端），否则同源 cookie（浏览器 WebSocket 自动携带，避免 token 进 URL 日志）
    const token = url.searchParams.get('token')
      || ((req.headers.cookie || '').match(/(?:^|;\s*)madazi_token=([^;]+)/) || [])[1]
      || null;
    const payload = verifyToken(token);
    if (!payload) { socket.destroy(); return; }

    // 全局 presence 端点：/api/ws/presence（一个连接订阅所有项目在线）
    const gmatch = url.pathname.match(/\/api\/ws\/presence/);
    if (gmatch) {
      req._globalPresenceCtx = { userId: payload.id, username: payload.username };
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    // 预览日志流端点：/api/ws/preview-log?projectId=xxx（server 自驱动增量推送 Pod stdout）
    const lmatch = url.pathname.match(/\/api\/ws\/preview-log/);
    if (lmatch) {
      let projectId = url.searchParams.get('projectId');
      if (!projectId) { socket.destroy(); return; }
      // ★ id 归一化：workbench 客户端可能传 8 位短 id（pv-xxxx 提取），而事件流
      //   buildLogStore 的 key 是完整 UUID → 短 id 时解析为完整 id，否则 [server]
      //   生命周期事件（Pod 已启动/就绪）永远匹配不上
      if (projectId.length < 32) {
        projectId = resolvePreviewProjectId(projectId) || projectId;
      }
      // ★ 多人平台权限：与 HTTP 路由 projectAccess 一致——系统管理员/owner/
      //   项目成员/共享项目可订阅，非成员登录用户不得窥视他人项目日志
      try {
        const role = await getProjectRole(payload.id, projectId);
        let allowed = !!role;
        if (!allowed) {
          const { rows } = await db.query('SELECT is_shared FROM projects WHERE id = $1', [projectId]);
          allowed = rows.length > 0 && rows[0].is_shared === true;
        }
        if (!allowed) {
          console.warn(`[project-ws] preview-log DENIED user=${payload.username} project=${projectId.slice(0, 8)}…（非项目成员）`);
          socket.destroy();
          return;
        }
      } catch (e) {
        console.warn('[project-ws] preview-log 权限校验异常，拒绝连接:', e.message);
        socket.destroy();
        return;
      }
      req._previewLogCtx = { projectId };
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    const match = url.pathname.match(/\/api\/projects\/([^/]+)\/ws/);
    if (!match) { socket.destroy(); return; }
    const projectId = match[1];

    req._projWsCtx = {
      projectId,
      userId: payload.id,
      username: payload.username,
    };

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    // 预览日志流：server 自驱动 1s 增量推送（WS 实时，前端零轮询）
    if (req._previewLogCtx) {
      const { projectId } = req._previewLogCtx;
      ws._projectId = projectId;
      let watchers = previewLogWatchers.get(projectId);
      if (!watchers) { watchers = new Set(); previewLogWatchers.set(projectId, watchers); }
      watchers.add(ws);
      console.log(`[project-ws] preview-log connect projectId=${projectId} watchers=${watchers.size}`);
      if (!previewLogTimers.has(projectId)) {
        const timer = setInterval(() => pushPreviewLogs(projectId), 1000);
        previewLogTimers.set(projectId, timer);
        pushPreviewLogs(projectId, true); // 首包全量
      }
      const drop = () => {
        // ★ 动态取（组可能已从短 id 迁到完整 id），否则迁移后 timer 泄漏
        const pid = ws._projectId || projectId;
        const set = previewLogWatchers.get(pid);
        if (set) { set.delete(ws); if (set.size === 0) { previewLogWatchers.delete(pid); } }
        if (!previewLogWatchers.has(pid)) {
          const t = previewLogTimers.get(pid);
          if (t) { clearInterval(t); previewLogTimers.delete(pid); previewLogLast.delete(pid); }
        }
      };
      ws.on('close', drop);
      ws.on('error', drop);
      return;
    }

    // 全局在线连接（登录即在线）：连接 = 在线声明，断开（登出/关页）= 下线
    if (req._globalPresenceCtx) {
      const { userId, username } = req._globalPresenceCtx;
      ws._userId = userId;
      ws._username = username;
      ws._lastPing = Date.now();
      globalPresenceWatchers.add(ws);
      globalUsers.set(userId, { user_id: userId, username });
      globalUserCount.set(userId, (globalUserCount.get(userId) || 0) + 1);
      reportPresence(); // 上报快照（本地 fanout 即广播；新连接者立即收到全量）
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'ping') { ws._lastPing = Date.now(); send(ws, { type: 'pong' }); }
        } catch { /* ignore */ }
      });
      const drop = () => {
        globalPresenceWatchers.delete(ws);
        const n = (globalUserCount.get(userId) || 1) - 1;
        if (n <= 0) { globalUserCount.delete(userId); globalUsers.delete(userId); }
        else globalUserCount.set(userId, n);
        reportPresence();
      };
      ws.on('close', drop);
      ws.on('error', drop);
      console.log(`[project-ws] ${username} online (global, ${globalUsers.size} online)`);
      return;
    }

    const { projectId, userId, username } = req._projWsCtx;
    const isWatch = new URL(req.url, 'http://localhost').searchParams.get('watch') === '1';
    ws._projectId = projectId;
    ws._userId = userId;
    ws._username = username;
    ws._lastPing = Date.now();

    if (isWatch) {
      // 观看者：不参与在线集合，仅接收 presence 广播（列表页实时徽标）
      if (!watchConnections.has(projectId)) watchConnections.set(projectId, new Set());
      watchConnections.get(projectId).add(ws);
      broadcastPresence(projectId); // 立即给观看者当前在线快照
      console.log(`[project-ws] ${username} watching project ${projectId}`);
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'ping') { ws._lastPing = Date.now(); send(ws, { type: 'pong' }); }
        } catch { /* ignore */ }
      });
      ws.on('close', () => {
        const conns = watchConnections.get(projectId);
        if (conns) {
          conns.delete(ws);
          if (conns.size === 0) watchConnections.delete(projectId);
        }
      });
      ws.on('error', () => {
        const conns = watchConnections.get(projectId);
        if (conns) { conns.delete(ws); if (conns.size === 0) watchConnections.delete(projectId); }
      });
      return;
    }

    // 加入项目连接池
    if (!projectConnections.has(projectId)) {
      projectConnections.set(projectId, new Set());
    }
    projectConnections.get(projectId).add(ws);
    console.log(`[project-ws] ${username} joined project ${projectId} (${projectConnections.get(projectId).size} online)`);

    // 立即广播在线状态（快照上报 + 全副本视图刷新）
    reportPresence();

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') {
          ws._lastPing = Date.now();
          send(ws, { type: 'pong' });
        }
      } catch { /* ignore invalid JSON */ }
    });

    ws.on('close', () => {
      const conns = projectConnections.get(projectId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) {
          projectConnections.delete(projectId);
        }
      }
      reportPresence();
      console.log(`[project-ws] ${username} left project ${projectId}`);
    });

    ws.on('error', () => {
      const conns = projectConnections.get(projectId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) projectConnections.delete(projectId);
      }
      reportPresence();
    });
  });

  // ★ 死连接清理：每 30s 扫描，清理超过 60s 未 ping 的连接
  setInterval(() => {
    const now = Date.now();
    for (const [pid, conns] of projectConnections) {
      for (const ws of conns) {
        if (now - (ws._lastPing || 0) > 60000) {
          console.log(`[project-ws] evicting dead connection: ${ws._username} (${pid})`);
          conns.delete(ws);
          try { ws.terminate(); } catch {}
        }
      }
      if (conns.size === 0) {
        projectConnections.delete(pid);
      }
    }
    for (const [pid, conns] of watchConnections) {
      for (const ws of conns) {
        if (now - (ws._lastPing || 0) > 60000) {
          conns.delete(ws);
          try { ws.terminate(); } catch {}
        }
      }
      if (conns.size === 0) watchConnections.delete(pid);
    }
    // 全局订阅者死连接清理
    for (const ws of globalPresenceWatchers) {
      if (now - (ws._lastPing || 0) > 60000) {
        globalPresenceWatchers.delete(ws);
        try { ws.terminate(); } catch {}
      }
    }
    // 清理可能改变了本地在线视图 → 上报刷新
    reportPresence();
  }, 30000);
}

/** 广播在线用户列表给项目所有连接（P1：合并视图 = 本地 + 远端副本快照） */
function broadcastPresence(projectId, viewsOpt) {
  const views = viewsOpt || mergedViews();
  const users = views.projects[projectId] || [];
  for (const ws of projectConnections.get(projectId) || []) {
    send(ws, { type: 'presence', users });
  }
  for (const ws of watchConnections.get(projectId) || []) {
    send(ws, { type: 'presence', users });
  }
  // 全局订阅者：带 projectId 广播（空列表也要发：人走光了同步清空）
  for (const ws of globalPresenceWatchers) {
    send(ws, { type: 'presence', projectId, users });
  }
}

/** 获取项目在线用户（供 HTTP API 调用；P1：合并视图跨副本） */
export function getProjectOnlineUsers(projectId) {
  return mergedViews().projects[projectId] || [];
}

/**
 * 广播对话事件给项目所有在线成员（除发送者外）
 * 用于协同对话：一人发消息/AI回复，其他人实时看到
 * P1：走总线——本地 fanout + 其他副本各自推本地连接（excludeUserId 全副本一致生效）
 * @param {string} projectId
 * @param {object} event - { type, conversationId, ... }
 * @param {string|null} excludeUserId - 不发给触发此事件的用户（避免自己重复显示）
 */
export function broadcastChatEvent(projectId, event, excludeUserId = null) {
  publish({ t: 'chat', projectId, event, excludeUserId });
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}
