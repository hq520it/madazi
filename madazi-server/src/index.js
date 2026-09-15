import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser'; // ★ S2-1：dsh-web 登录门 cookie 解析
import dotenv from 'dotenv';
import { initDb } from './db/init.js';
import { initAdmin } from './middleware/initAdmin.js';
import { startIdleCleanup, stopPreview } from './services/preview.js';
import { handleTerminalWS, stopTerminal } from './services/terminal.js';
import { setupCollabWS, getProjectRooms } from './services/collab.js';
import { setupProjectWS } from './services/project-ws.js';
import projectRoutes from './routes/projects.js';
import memberRoutes from './routes/members.js';
import projectDbRoutes from './routes/project-db.js';
import llmRoutes from './routes/llm.js';
import templateRoutes from './routes/templates.js';
import previewRoutes, { setupPreviewProxy, handlePreviewWS } from './routes/preview.js';
import { setupDshWebProxy, registerAuthCheck } from './services/dsh-web-proxy.js';
import authRoutes from './routes/auth.js';
import oauthRoutes from './routes/oauth.js';
import keysRoutes from './routes/keys.js';
import { auth } from './middleware/auth.js'; // ★ P2-9 collab/status 鉴权
import adminRoutes from './routes/admin.js';
import marketRoutes, { adminRouter as adminMarketRoutes } from './routes/market.js';
import pluginRoutes from './routes/plugins.js';
import dshMetaRoutes from './routes/dsh-meta.js';
import skillRoutes, { syncGlobalSkills } from './routes/skills.js';
import licenseRoutes, { licenseGate } from './routes/license.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors());

// ★ S2-1：解析 madazi_token cookie（res.cookie/clearCookie 需要它；auth 中间件手写解析已兼容）
app.use(cookieParser());

// Register preview proxy BEFORE express.json() so POST bodies aren't consumed
setupPreviewProxy(app);
// 官方 DSH Web UI 同域反代（/dsh-web 页面 + /socket.io + /plugins，返回 WS upgrade handler）
const handleDshWebWS = setupDshWebProxy(app);
// ★ P3：Traefik 入口层 forwardAuth 探针（dsh 数据面登录门外移到 Traefik 后的判定端点）
//   挂 licenseGate 前 = 与 dsh 反代路径同语义（gate 不连坐 dsh）
registerAuthCheck(app);

app.use(express.json({ limit: '10mb' }));

// License 门禁：未激活/过期/域名不匹配 → 全站 403（放行 /api/health 与 /api/license）
app.use('/api', licenseGate);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'madazi-server', version: '0.1.0' });
});

// 协作状态查询（★ P2-9 修复：原无鉴权，泄露项目房间/成员信息，挂 auth）
app.get('/api/projects/:id/collab/status', auth, (req, res) => {
  res.json({ rooms: getProjectRooms(req.params.id) });
});

app.use('/api/auth', authRoutes);
app.use('/api/auth/oauth', oauthRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/market', adminMarketRoutes);
app.use('/api/admin/plugins', pluginRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', memberRoutes);
app.use('/api/projects', previewRoutes);
app.use('/api/projects', projectDbRoutes);
app.use('/api/dsh', dshMetaRoutes);
app.use('/api/llm', llmRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/license', licenseRoutes);

// 全局错误处理：防止未捕获的异常导致进程崩溃
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

initDb().then(async () => {
  await initAdmin(); // 初始化默认管理员账号
  // ★ 模板市场：内置 templates/ 目录同步注册为官方市场条目（幂等，失败不阻塞启动）
  try {
    const { syncOfficialTemplates } = await import('./services/market.js');
    await syncOfficialTemplates();
  } catch (err) {
    console.error('[market] 官方模板同步失败（启动继续）:', err.message);
  }
  // ★ 内置技能全局同步：is_builtin 的公开技能写 $DSH_HOME/skills，所有项目免安装自动可用（幂等，失败不阻塞启动）
  try {
    const n = await syncGlobalSkills();
    if (n) console.log(`[skills] 内置技能全局同步完成（${n} 个 → $DSH_HOME/skills）`);
  } catch (err) {
    console.error('[skills] 内置技能全局同步失败（启动继续）:', err.message);
  }
  startIdleCleanup(); // 启动空闲预览清理定时器（60s 扫描 + 孤儿 Pod 清扫）
  // ★ 恢复现场：docker 单机扫运行中容器 / K8s 扫 Running Pod，回填内存 Map
  const { recoverPreviewPodsToMap } = await import(process.env.PREVIEW_MODE === 'docker' ? './services/preview-docker.js' : './services/preview-k8s.js');
  recoverPreviewPodsToMap();
  // ★ P0-B R5：启动扫描——DB 悬挂任务（pending/running）置 failed（存活执行者直写终态会覆盖，最终一致）
  const { recoverInterruptedTasks } = await import('./services/chat-tasks.js');
  recoverInterruptedTasks();
  const server = app.listen(PORT, () => {
    console.log(`madazi-server running on http://localhost:${PORT}`);
  });

  // WebSocket 升级：终端 / 协作 / 项目 / 预览 HMR
  // ★ 2026-09-08 async 兜底：任何分支抛异常（handlePreviewWS 网络抖动等）若不 catch，
  //   unhandledRejection 直接崩进程 → 全站断线（与 http-proxy throw 同源，一并防护）。
  server.on('upgrade', async (req, socket, head) => {
    try {
      if (req.url.startsWith('/ws') || req.url.startsWith('/socket.io') || req.url.startsWith('/api/events')) {
        // 官方 DSH Web UI WebSocket（/ws 原生 + /socket.io + /api/events.mux|host 事件流）→ web pod
        // 平台项目 WS 是 /api/projects/:id/ws（含 /api 前缀），不会误入此分支
        handleDshWebWS(req, socket, head);
      } else if (req.url.includes('/terminal')) {
        // 终端 WebSocket：/api/projects/:id/terminal?token=JWT
        handleTerminalWS(req, socket, head);
      } else if (req.url.includes('/collab')) {
        // 协作 WebSocket：/api/projects/:id/collab?file=<path>&token=JWT
        // setupCollabWS 自己注册的 upgrade handler 会处理
      } else if (req.url.includes('/ws')) {
        // 项目级 WebSocket：/api/projects/:id/ws?token=JWT
        // setupProjectWS 自己注册的 upgrade handler 会处理
      } else if (req.url.startsWith('/api/remote.')) {
        // ★ 单机版：dsh 远程 mux WS（/api/remote.mux，Cordis 内核 ↔ 工作台事件流根）。
        // 云版浏览器直连 dsh 自身 webserver 无此问题；单机 server 反代后此路径漏转发，
        // 落入 else 被 handlePreviewWS destroy → 浏览器「自动连接中」无限重试。显式转 dsh web。
        handleDshWebWS(req, socket, head);
      } else {
        // 预览子域名 WS（Vite HMR 等）异步判断：非预览域名同步 return false，命中则代理
        // async 化后返回 Promise，不能直接当布尔用
        const handled = await handlePreviewWS(req, socket, head);
        if (!handled) socket.destroy();
      }
    } catch (e) {
      console.error('[upgrade] unhandled error, destroying socket:', e && e.message);
      try { socket.destroy(); } catch { /* ignore */ }
    }
  });

  // 初始化 Yjs 协作 WebSocket（自己监听 upgrade）
  setupCollabWS(server);
  // 初始化项目级 WebSocket（在线状态 + 任务推送）
  setupProjectWS(server);
});
