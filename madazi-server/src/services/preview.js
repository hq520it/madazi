import { db } from '../db/init.js';
import { getSettingNumber } from './settings.js';
import fs from 'fs';
import path from 'path';
import { stopTerminal } from './terminal.js';
import { pushBuildLog, waitForService } from './docker-build.js';

// ★ 预览后端选择：PREVIEW_MODE=docker → Docker 单机（免 K8s，端口隔离）；默认 K8s Pod。
//   preview-docker.js / preview-k8s.js 导出同名接口，调用点统一走 previewBackend() 动态 import
export function previewBackend() {
  return process.env.PREVIEW_MODE === 'docker'
    ? import('./preview-docker.js')
    : import('./preview-k8s.js');
}

// ★ 预览浏览器 URL（前端 iframe / 新标签用）：
//   docker 模式 = http://127.0.0.1:<hostPort>/（无子域名，端口隔离即跨域隔离；podIP 未就绪返回 ''）
//   K8s 模式 = https://pv-<id8>.<域>/（无子域名时沿用 pv- 短域名）
export function previewUrlFor(projectId, podIP) {
  return pvShortUrl(projectId, podIP);
}

// ★ 规则式预览配置（替代平台 AI analyzePreviewConfig）：
//   模型是用户 BYOK 的，平台侧逐模型适配输出格式太脆弱——导入时按文件规则生成
//   .preview-config.json，启动方式不对时用户在对话中让 AI 修正（日志面板有「AI 修复」入口）。
//   start.sh 启动时优先消费该文件（桥接层）。
//   返回 { created, reason }；模板布局（frontend/ 子目录）不生成，走 start.sh 模板分支。
// ★ 短 URL 预览（2026-09-01）：vite base=/，返回 pv-<id8>.<域>/ 短域名即可直接打开应用。
//   （旧长路径 /api/projects/<id>/preview-proxy 已废弃）
// ★ 单机 docker 模式（2026-09）：无子域名，直连 http://127.0.0.1:<hostPort>/（podIP 形如 127.0.0.1:<port>）
function pvShortUrl(projectId, podIP) {
  if (process.env.PREVIEW_MODE === 'docker') {
    return podIP ? `http://${podIP}/` : '';
  }
  const domain = process.env.PREVIEW_DOMAIN || '<YOUR-DOMAIN>.com';
  return `https://pv-${String(projectId).slice(0, 8)}.${domain}/`;
}
function ensurePreviewConfig(sourcePath) {
  const configPath = path.join(sourcePath, '.preview-config.json');
  if (fs.existsSync(configPath)) {
    // ★ 存量配置自愈：旧平台 AI 生成的 workdir 可能是绝对路径或已失效目录（如 /data/projects/<旧名>），
    //   容器内不存在 → 构建段直接崩。workdir 必须是「空或项目内相对路径」，否则修为项目根
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      let repaired = false;
      const fixes = [];
      const wd = cfg && typeof cfg === 'object' ? cfg.workdir : null;
      if (typeof wd === 'string' && wd !== ''
        && (wd.startsWith('/') || !fs.existsSync(path.join(sourcePath, wd)))) {
        cfg.workdir = '';
        repaired = true;
        fixes.push(`失效 workdir（${wd} → 项目根）`);
      }
      // ★ pnpm/yarn 不吞「 -- 」分隔符（只有 npm 会）——`pnpm run dev -- --port 5173` 会把 --
      //   当字面量传给 vite，被当作「选项结束」，端口等参数全部作废（实际起在项目配置的端口）
      if (cfg && typeof cfg.start_cmd === 'string'
        && /^\s*(pnpm|yarn)\b/.test(cfg.start_cmd) && cfg.start_cmd.includes(' -- ')) {
        cfg.start_cmd = cfg.start_cmd.replace(' -- ', ' ');
        repaired = true;
        fixes.push('pnpm/yarn 多余「--」分隔符');
      }
      if (repaired) {
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        return { created: false, reason: `已修正${fixes.join('、')}` };
      }
    } catch { /* 配置损坏则按原样使用 */ return { created: false, reason: '配置已存在（解析失败，按原样使用）' }; }
    return { created: false, reason: '已存在配置' };
  }
  if (fs.existsSync(path.join(sourcePath, 'frontend'))) return { created: false, reason: '模板布局，走模板分支' };

  const rootPkgPath = path.join(sourcePath, 'package.json');
  const hasRootPkg = fs.existsSync(rootPkgPath);
  const hasIndexHtml = fs.existsSync(path.join(sourcePath, 'index.html'));
  const hasBackendDir = fs.existsSync(path.join(sourcePath, 'backend'));

  const cfg = { tech_stack: 'unknown', install_cmd: '', start_cmd: '', backend_cmd: '', workdir: '', port: 5173, env: {} };
  let reason = '未识别项目类型，生成空配置';

  if (hasRootPkg) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')); } catch { /* 按空 pkg 处理 */ }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};
    const pm = fs.existsSync(path.join(sourcePath, 'pnpm-lock.yaml')) ? 'pnpm'
      : fs.existsSync(path.join(sourcePath, 'yarn.lock')) ? 'yarn' : 'npm';
    cfg.install_cmd = `${pm} install`;
    const isFrontend = hasIndexHtml || deps.vite || deps.react || deps.vue || deps['@vitejs/plugin-react'] || deps['@vitejs/plugin-vue'];
    if (deps.react) cfg.tech_stack = 'node-react';
    else if (deps.vue) cfg.tech_stack = 'node-vue';
    // ★ run-script 传参：npm 需要「 -- 」分隔符且会吞掉它；pnpm/yarn 不吞（-- 会被当字面量
    //   传给 vite 成为「选项结束」标记，后续参数全作废）——按包管理器分别拼
    const hostArgs = '--host 0.0.0.0 --port 5173 --strictPort';
    const devCmd = pm === 'npm' ? `npm run dev -- ${hostArgs}` : `${pm} run dev ${hostArgs}`;
    if (isFrontend) {
      cfg.start_cmd = scripts.dev ? devCmd : 'npx vite --host 0.0.0.0 --port 5173 --strictPort';
      reason = `根目录前端项目（${cfg.tech_stack}，${pm}）`;
    } else if (scripts.start || scripts.dev) {
      // 纯后端 node：启动脚本跑后端，预览端口 5173 不可达属预期（日志面板可见错误，AI 可修）
      cfg.start_cmd = scripts.dev ? `${pm} run dev` : `${pm} start`;
      reason = '根目录 Node 项目（未识别到前端信号，按后端启动）';
    }
    if (hasBackendDir && fs.existsSync(path.join(sourcePath, 'backend', 'package.json'))) {
      cfg.backend_cmd = 'cd backend && npm install && npm start';
      if (isFrontend) cfg.tech_stack = cfg.tech_stack.replace('node-', 'node-fullstack-');
    }
  } else if (hasIndexHtml) {
    cfg.tech_stack = 'static';
    cfg.start_cmd = 'npx serve -s -l 5173';
    reason = '纯静态项目';
  }

  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  return { created: true, reason };
}

// project_id -> { podName, podIP, port, status, backendReady, frontendReady,
//                 userId, projectId, projectName, startedAt, lastAccessedAt }
const previews = new Map();
let nextPort = 9100;

// ★ 端口自适应：导入项目实际监听端口由 Pod 内 watcher 探测回写 PVC .preview-port
//   （CLI --port 并非所有框架都吃得住），探活/代理以它为准；5s 缓存避免热路径反复读盘
const previewPortCache = new Map(); // projectId -> { port: number|null, at: number }
export async function resolvePreviewPort(projectId) {
  const c = previewPortCache.get(projectId);
  if (c && Date.now() - c.at < 5000) return c.port;
  let port = null;
  try {
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
    const sp = rows[0]?.source_path;
    if (sp) {
      const raw = fs.readFileSync(path.join(sp, '.preview-port'), 'utf8').trim();
      const n = parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 1024 && n <= 65535) port = n;
    }
  } catch { /* 文件未生成/查询失败 → null，回落 5173 */ }
  previewPortCache.set(projectId, { port, at: Date.now() });
  return port;
}

// 统计某用户的活跃预览数
function getUserPreviews(userId) {
  return Array.from(previews.values()).filter(p => p.userId === userId);
}

// 更新预览的最后访问时间（用于空闲清理）
export function touchPreview(projectId) {
  const preview = previews.get(projectId);
  if (preview) {
    preview.lastAccessedAt = Date.now();
  }
}

export async function startPreview(projectId, userId) {
  // 1. 容器复用检查（已有且 running/starting -> 直接返回，更新 lastAccessedAt）
  const existing = previews.get(projectId);
  if (existing && (existing.status === 'ready' || existing.status === 'starting')) {
    // 模式化后端：docker 单机 / K8s 统一走 getPreviewPodStatus 判断
    try {
      const bk = await previewBackend();
      const st = await bk.getPreviewPodStatus(projectId);
      if (st.ready) {
        existing.lastAccessedAt = Date.now();
        return {
          port: existing.port,
          url: pvShortUrl(projectId, st.podIP),
          status: existing.status,
        };
      }
    } catch {
      // 查询失败则视为需重建
    }
    // Pod 已死，清理后重建
    previews.delete(projectId);
  }

  // ★ K8s 恢复现场：server 重启后内存 Map 空，但 Pod 可能还在 Running。
  // 查 Pod 状态并回填 Map（podName/podIP/前端就绪标记），避免盲目重建 + 预览代理 404。
  try {
    const bk = await previewBackend();
    const st = await bk.getPreviewPodStatus(projectId, await resolvePreviewPort(projectId));
    // ★ Failed/Succeeded 的 Pod 永远不会变 ready——若走下方"恢复 starting"分支用户会永远卡住，
    //   先删除让它落到正常重建流程
    if (st.exists && !st.deleting && (st.phase === 'Failed' || st.phase === 'Succeeded')) {
      console.log(`[preview] Pod phase=${st.phase}，删除后重建: ${projectId}`);
      await bk.deletePreviewPod(projectId).catch(() => {});
      st.exists = false;
    }
    // ★ Pod 存在但未就绪（构建中/刚启动）→ 回填 starting，防止孤儿回收器宽限后误删
    if (st.exists && !st.ready && !st.deleting) {
      let projectName = projectId.slice(0, 8);
      try {
        const { db } = await import('../db/init.js');
        const { rows } = await db.query('SELECT name FROM projects WHERE id = $1', [projectId]);
        if (rows[0]?.name) projectName = rows[0].name;
      } catch {}
      previews.set(projectId, {
        projectId,
        projectName,
        podName: `madazi-preview-${projectId.slice(0, 8)}`,
        podIP: st.podIP || '',
        frontendReady: false,
        backendReady: false,
        status: 'starting',
        startedAt: Date.now(),
        lastAccessedAt: Date.now(),
      });
      console.log(`[preview] Recovered starting preview (exists, not ready): ${projectId}`);
      return {
        url: pvShortUrl(projectId, st.podIP),
        status: 'starting',
      };
    }
    if (st.ready) {
        // 查项目名回填（getPreviewsByUser/代理目标需要）
        let projectName = projectId.slice(0, 8);
        try {
          const { db } = await import('../db/init.js');
          const { rows } = await db.query('SELECT name FROM projects WHERE id = $1', [projectId]);
          if (rows[0]?.name) projectName = rows[0].name;
        } catch {}
        previews.set(projectId, {
          projectId,
          projectName,
          podName: `madazi-preview-${projectId.slice(0, 8)}`,
          podIP: st.podIP,
          frontendReady: true,
          backendReady: true,
          status: 'ready',
          startedAt: Date.now(),
          lastAccessedAt: Date.now(),
        });
        console.log(`[preview] Recovered preview from running Pod: ${st.podIP}`);
        return {
          url: pvShortUrl(projectId, st.podIP),
          status: 'ready',
        };
      }
    } catch {
      // Pod 不存在或查询失败 -> 走正常重建流程
    }

  // 2. 并发数检查（需 userId）
  if (userId) {
    const maxPerUser = await getSettingNumber('preview_max_per_user', 3);
    const userPreviews = getUserPreviews(userId);
    if (userPreviews.length >= maxPerUser) {
      return {
        status: 'limit_reached',
        max: maxPerUser,
        existing: userPreviews.map(p => ({
          projectId: p.projectId,
          projectName: p.projectName,
          startedAt: p.startedAt,
        })),
      };
    }
  }

  // 3. 全局上限检查
  const globalMax = await getSettingNumber('preview_global_max', 20);
  if (previews.size >= globalMax) {
    return { status: 'global_limit_reached', max: globalMax };
  }

  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) throw new Error('Project not found');
  if (!rows[0].source_path) throw new Error('Project not generated yet');
  const project = rows[0];

  const sourcePath = rows[0].source_path;
  const projectDirName = path.basename(sourcePath);
  const projectName = rows[0].name;

  // ★ 导入项目：先生成规则式预览配置（必须在 hasFrontend/hasBackend 探测与建 Pod 之前，
  //   否则首轮启动 pod env 仍按模板布局误判「无前端」，entrypoint 直接跳过前端构建段）
  const isTemplate = project.source_type === 'template';
  if (!isTemplate) {
    try {
      const r = ensurePreviewConfig(sourcePath);
      pushBuildLog(projectId, r.created
        ? `📝 已生成 .preview-config.json（${r.reason}）；若启动方式不对，可在对话中让 AI 修正该文件后重启预览\n`
        : `📝 预览配置：${r.reason}\n`, 'building');
    } catch (e) {
      console.error(`[preview-k8s] ensurePreviewConfig failed:`, e.message);
      pushBuildLog(projectId, `⚠️ 预览配置生成失败: ${e.message}\n`, 'building');
    }
  }
  let pvCfg = null;
  try {
    pvCfg = JSON.parse(fs.readFileSync(path.join(sourcePath, '.preview-config.json'), 'utf8'));
  } catch { /* 无配置：模板布局 */ }

  // ★ hasFrontend 不再只认模板布局（frontend/ 子目录）：根目录 index.html（纯前端导入）
  //   或 .preview-config.json 带 start_cmd 都算有前端，否则 pod env 误导启动脚本判「无前端」
  const hasFrontend = fs.existsSync(path.join(sourcePath, 'frontend'))
    || fs.existsSync(path.join(sourcePath, 'index.html'))
    || !!(pvCfg && pvCfg.start_cmd);
  const hasBackendDir = fs.existsSync(path.join(sourcePath, 'backend'));
  const hasPomXml = hasBackendDir && fs.existsSync(path.join(sourcePath, 'backend', 'pom.xml'));
  const hasBackendPkg = hasBackendDir && fs.existsSync(path.join(sourcePath, 'backend', 'package.json'));
  const hasGoMod = hasBackendDir && fs.existsSync(path.join(sourcePath, 'backend', 'go.mod'));
  const hasPythonReq = hasBackendDir && (
    fs.existsSync(path.join(sourcePath, 'backend', 'requirements.txt')) ||
    fs.existsSync(path.join(sourcePath, 'backend', 'pyproject.toml'))
  );
  const hasBackend = hasPomXml || hasBackendPkg || hasGoMod || hasPythonReq || !!(pvCfg && pvCfg.backend_cmd);

  const port = nextPort++;

  // 4. 读取资源限制
  const cpuLimit = await getSettingNumber('preview_cpu_limit', 1);
  const memoryLimit = await getSettingNumber('preview_memory_limit', 2048);

  previews.set(projectId, {
    container: null,
    port,
    status: 'starting',
    backendReady: false,
    frontendReady: false,
    userId: userId || null,
    projectId,
    projectName,
    projectDirName, // 容器内 /data/<dir>
    startedAt: Date.now(),
    lastAccessedAt: Date.now(),
  });

  // Async start - 方案C：Dockerfile 模板 + AI 优化循环
  (async () => {
    try {
      // ========== K8s 模式 ==========
      // ★ K8s 模式（USE_K8S=1 固定，单机 docker 版已移除）
        // 模板项目：技术栈已知，用专用小镜像；导入项目：通用 runtime 镜像
        if (isTemplate) {
          pushBuildLog(projectId, `🚀 K8s 模式：模板项目 (${project.tech_stack})，使用专用镜像\n`, 'building');
        } else {
          pushBuildLog(projectId, `🚀 K8s 模式：导入项目，使用通用 runtime 镜像\n`, 'building');
        }
        
        // 建 Pod / 容器
        const bk = await previewBackend();
        // ★ docker 模式必须传 host 绝对源码路径（docker run -v 挂载源）
        const { podName, podIP } = await bk.createPreviewPod(projectId, {
          projectDirName,
          sourcePath,
          hasFrontend,
          hasBackend,
          memoryLimit: `${memoryLimit}Mi`,
          cpuLimit: `${cpuLimit * 1000}m`,
          techStack: project.tech_stack,
          sourceType: project.source_type,
        });
        const preview = previews.get(projectId);
        if (preview) {
          preview.podName = podName;
          preview.podIP = podIP;
        }
        console.log(`[preview-k8s] Pod started: ${podName} at ${podIP}`);
        pushBuildLog(projectId, `🚀 Pod 已启动: ${podName} (${podIP})\n`, 'building');

        // 等待前端就绪——★ 端口自适应：导入项目实际端口由 Pod 内 watcher 回写 .preview-port，
        // 每轮探测前重读（watcher 3s 周期更新），无文件时回落约定 5173
        const deadline = Date.now() + 300000;
        let ready = false;
        while (Date.now() < deadline) {
          const hint = await resolvePreviewPort(projectId);
          ready = await waitForService(`http://${podIP}:${hint || 5173}/`, 5000);
          if (ready) {
            if (hint && hint !== 5173) pushBuildLog(projectId, `🔌 检测到前端实际端口: ${hint}\n`, 'building');
            break;
          }
        }
        if (preview) {
          preview.frontendReady = ready;
          preview.backendReady = true;
          preview.status = ready ? 'ready' : 'error';
          preview.lastAccessedAt = Date.now();
        }
        console.log(`[preview-k8s] Ready: ${ready}`);
        pushBuildLog(projectId, ready ? `✅ 预览就绪!\n` : `❌ 预览未就绪\n`, ready ? 'done' : 'error');

        if (ready) {
          try {
            await db.query('UPDATE projects SET build_status = $1 WHERE id = $2', ['success', projectId]);
          } catch (e) {
            console.error(`[preview-k8s] Failed to update DB build_status:`, e.message);
          }
        }
        return;
    } catch (err) {
      console.error('[preview] Start error:', err.message);
      pushBuildLog(projectId, `❌ 启动失败: ${err.message}\n`, 'error');
      const preview = previews.get(projectId);
      if (preview) preview.status = 'error';
    }
  })();

  return { port, url: pvShortUrl(projectId), status: 'starting' };
}

export async function stopPreview(projectId) {
  // 先关闭该项目的终端会话
  try { stopTerminal(projectId); } catch {}

  // 模式化后端：删 Pod / 容器（docker suspend 语义 = docker rm）
  const bk = await previewBackend();
  await bk.deletePreviewPod(projectId);
  previews.delete(projectId);

  // ★ 清本轮生命周期事件 + 重置日志增量基线：下一轮 startPreview 的事件流从头开始，
  //   控制台 WS 首包走全量 reset（避免上一轮「✅ 预览就绪」残留混入新一轮）
  try {
    const { buildLogStore } = await import('./docker-build.js');
    buildLogStore.delete(projectId);
    const { resetPreviewLogBaseline } = await import('./project-ws.js');
    resetPreviewLogBaseline(projectId);
  } catch {}
}

export function getPreview(projectId) {
  return previews.get(projectId);
}

export function setPreview(projectId, data) {
  previews.set(projectId, data);
}

export function getAllPreviews() {
  return Array.from(previews.entries()).map(([projectId, p]) => ({ ...p, projectId }));
}

// ============ 空闲清理定时器 ============
let cleanupTimer = null;
/** 孤儿 preview Pod 首见时间（projectId -> timestamp），宽限用 */
const previewOrphanSeen = new Map();

export function startIdleCleanup() {
  if (cleanupTimer) return; // 防止重复启动
  cleanupTimer = setInterval(async () => {
    const timeoutSeconds = await getSettingNumber('preview_idle_timeout', 86400);
    const now = Date.now();
    for (const [projectId, preview] of previews) {
      // 只清理已经 ready 或 error 的预览；starting 中跳过
      if (preview.status === 'starting') continue;
      const idleSeconds = (now - preview.lastAccessedAt) / 1000;
      if (idleSeconds > timeoutSeconds) {
        console.log(`[cleanup] Suspending idle preview: ${projectId} (idle ${Math.round(idleSeconds)}s, name=${preview.projectName})`);
        await stopPreview(projectId);
      }
    }
    // ★ 孤儿 preview Pod/容器 清扫（server 重启后 Map 外的 Pod）
    const grace = parseInt(process.env.ORPHAN_GRACE_MS || '300000');
    const bk = await previewBackend();
    await bk.reapOrphanPreviewPods(Array.from(previews.keys()), previewOrphanSeen, grace);
  }, 60000); // 60 秒扫描一次
  console.log('[preview] Idle cleanup started (interval=60s, suspend only + orphan reap)');
}

/**
 * ★ K8s 恢复现场（代理层共用）：按 podIP 回填内存 Map。
 * server 重启后 Map 空，但 preview Pod 可能还在 Running——查 DB 拿项目信息重建 preview 记录，
 * 使子域名代理/WS 代理/logs 不再 404。幂等：已有记录时直接返回。
 */
export async function recoverPreviewFromPod(projectId, podIP, podName) {
  let existing = previews.get(projectId);
  if (existing?.podIP) return existing;
  try {
    const { db } = await import('../db/init.js');
    const { rows } = await db.query('SELECT name, source_path FROM projects WHERE id = $1', [projectId]);
    if (!rows[0]?.source_path) return null;
    const path = await import('path');
    const rec = {
      podName,
      podIP,
      port: null,
      status: 'ready',
      backendReady: true,
      frontendReady: true,
      projectId,
      projectName: rows[0].name,
      projectDirName: path.basename(rows[0].source_path),
      startedAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    previews.set(projectId, rec);
    console.log(`[preview] Recovered from running Pod: ${podName} @ ${podIP}`);
    return rec;
  } catch (e) {
    console.error('[preview] recoverPreviewFromPod failed:', e.message);
    return null;
  }
}


