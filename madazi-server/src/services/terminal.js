import { verifyToken } from '../middleware/auth.js';
import { getProjectRole } from '../middleware/permission.js';
import { execPreviewPodShell } from './terminal-k8s.js';

// 活跃终端会话：projectId -> { exec, stream, ws }
// ★ 修复：同项目多终端并存。原实现 Map<projectId, session> 后开覆盖先开、
// close 误杀并存会话。改为 Map<projectId, Set<session>>，每个 WS 连接独立
// 生命周期，close 只清自己；stopTerminal（预览关闭）才清全部。
const sessions = new Map();

// 动态加载 preview 服务避免循环依赖
async function getPreviewService() {
  return await import('./preview.js');
}

/**
 * 处理终端 WebSocket 升级
 * URL 格式：/api/projects/:id/terminal?token=JWT
 *
 * 协议：
 *   - 客户端 -> 服务端：
 *       - 纯文本：作为 stdin 发给容器
 *       - JSON { type: 'resize', cols, rows }：调整终端大小
 *   - 服务端 -> 客户端：
 *       - 纯文本：终端 stdout/stderr 输出
 *       - JSON { type: 'exit', code }：进程退出
 *       - JSON { type: 'error', message }：错误
 */
export async function handleTerminalWS(req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  const match = url.pathname.match(/\/api\/projects\/([^/]+)\/terminal/);
  if (!match) return socket.destroy();

  const projectId = match[1];
  const token = url.searchParams.get('token');
  const payload = verifyToken(token);
  if (!payload) return socket.destroy();

  // ★ P0-1 修复：WS 升级前校验项目成员资格（与 HTTP 路由一致）
  // 防止任意登录用户连入他人预览容器 bash（容器挂源码卷 + PG 数据卷）
  // 兼容 is_shared=true 的共享项目（与 projectAccess 中间件逻辑一致）
  try {
    const role = await getProjectRole(payload.id, projectId);
    if (!role) {
      const { db } = await import('../db/init.js');
      const { rows } = await db.query('SELECT is_shared FROM projects WHERE id = $1', [projectId]);
      const shared = rows.length > 0 && rows[0].is_shared === true;
      if (!shared) {
        console.warn(`[terminal] WS rejected: user ${payload.id} is not a member of project ${projectId}`);
        return socket.destroy();
      }
    }
  } catch (e) {
    console.error('[terminal] Failed to check project role:', e.message);
    return socket.destroy();
  }

  console.log('[terminal] WS request for', projectId);
  const t0 = Date.now();
  const { getPreview, touchPreview } = await getPreviewService();
  console.log('[terminal] getPreviewService:', Date.now() - t0, 'ms');
  let preview = getPreview(projectId);
  console.log('[terminal] getPreview:', Date.now() - t0, 'ms');
  if (!preview) {
    // ★ K8s 恢复现场：Map 空但 Pod 可能还在 Running，查 Pod 状态回填
    try {
      const { getPreviewPodStatus } = await import('./preview-k8s.js');
      const st = await getPreviewPodStatus(projectId);
      if (st.ready) {
        const { db } = await import('../db/init.js');
        const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
        if (rows[0]?.source_path) {
          const path = await import('path');
          const { setPreview } = await getPreviewService();
          setPreview(projectId, {
            podName: `madazi-preview-${projectId.slice(0, 8)}`,
            podIP: st.podIP,
            port: null,
            status: 'ready',
            backendReady: true,
            frontendReady: true,
            userId: payload.id || null, // ★ P2-12 修复：payload.userId 恒 undefined（JWT 只含 id）
            projectId,
            projectName: rows[0].name,
            projectDirName: path.basename(rows[0].source_path),
            startedAt: Date.now(),
            lastAccessedAt: Date.now(),
          });
          preview = getPreview(projectId);
          console.log(`[terminal] Recovered preview from running Pod: ${st.podIP}`);
        }
      }
    } catch (e) {
      console.error('[terminal] Failed to recover preview from K8s:', e.message);
    }
  }
  if (!preview) return socket.destroy();
  touchPreview(projectId);
  console.log('[terminal] preview ready, upgrading WS at', Date.now() - t0, 'ms');

  const { WebSocketServer } = await import('ws');
  const wss = new WebSocketServer({ noServer: true });
  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log('[terminal] WS upgraded at', Date.now() - t0, 'ms');
    handleConnection(ws, projectId, preview, t0);
  });
}

async function handleConnection(ws, projectId, preview, t0) {
  let exec = null;
  let stream = null;

  // ★ K8s 模式：K8s exec WebSocket（v5.channel.k8s.io），不依赖 docker.sock
    const shell = execPreviewPodShell(projectId, {
      projectDirName: preview?.projectDirName,
      onOutput: (chunk) => { if (ws.readyState === 1) ws.send(chunk); },
      onExit: (code) => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code }));
        cleanup(projectId, ws);
      },
      onError: (msg) => {
        console.error('[terminal-k8s] exec error:', msg);
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: `K8s 终端错误: ${msg}` }));
        cleanup(projectId, ws);
      },
    });
    addSession(projectId, { k8sShell: shell, ws });

    ws.on('message', (raw) => {
      const msg = raw.toString();
      if (msg.startsWith('{')) {
        try {
          const ctrl = JSON.parse(msg);
          if (ctrl.type === 'resize' && ctrl.cols && ctrl.rows) {
            shell.resize(ctrl.cols, ctrl.rows);
            return;
          }
        } catch {}
      }
      shell.write(msg);
    });
    ws.on('close', () => { shell.destroy(); cleanup(projectId, ws); });
    ws.on('error', () => { shell.destroy(); cleanup(projectId, ws); });

  cleanup(projectId, ws);
}

/** 登记会话（同项目多终端并存） */
function addSession(projectId, session) {
  let set = sessions.get(projectId);
  if (!set) { set = new Set(); sessions.set(projectId, set); }
  set.add(session);
}

/** 清理单个会话（只清自己，不动同项目其他终端） */
function cleanup(projectId, ws) {
  const set = sessions.get(projectId);
  if (!set) return;
  for (const s of set) {
    if (ws && s.ws !== ws) continue; // 只清指定连接
    try { s.stream?.destroy?.(); } catch {}
    try { s.k8sShell?.destroy?.(); } catch {}
    try { s.ws.close(); } catch {}
    set.delete(s);
  }
  if (!set.size) sessions.delete(projectId);
}

/** 停止项目的终端会话（预览关闭时调用，清全部） */
export function stopTerminal(projectId) {
  cleanup(projectId, null);
}
