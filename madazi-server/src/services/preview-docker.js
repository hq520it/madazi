// preview-docker.js — 单机版（免 K8s）preview 后端：Docker 单容器
// 实现与 preview-k8s.js 相同的导出接口，preview.js / routes/preview.js 按
// PREVIEW_MODE=docker 切换（single-node.md M4 定稿：Docker 单容器 + localhost 端口）。
//
// 形态：每个项目一个容器
//   docker run -d --name madazi-preview-<id8>
//     --label project-id=<id> --label managed-by=madazi-server
//     -e PROJECT_ID -e PROJECT_DIR -e HAS_FRONTEND -e HAS_BACKEND
//     -v <sourcePath>:/data/<projectDirName>     （源码直挂，跨重启持久）
//     -p 127.0.0.1:<hostPort>:5173
//     镜像：模板项目按 tech_stack 选专用小镜像；导入项目用通用 runtime
// 预览 URL：http://127.0.0.1:<hostPort>/（无子域名，端口隔离即跨域隔离）
// 端口段：31000 起递增（系统级分配，避免与平台 3456/dsh 3080 冲突）

import { execFile } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PREVIEW_MODE_DOCKER = process.env.PREVIEW_MODE === 'docker';
const hostPortSeq = { next: parseInt(process.env.PREVIEW_HOST_PORT_BASE || '31000', 10) };

const log = (...args) => console.log('[preview-docker]', ...args);

// 镜像映射（与 preview-k8s 同口径，模板 → 小镜像 / 导入 → runtime）
const IMAGE_MAP = {
  'frontend-only': process.env.PREVIEW_IMAGE_FRONTEND_ONLY || 'madazi-preview-frontend-only:v02',
  'node': process.env.PREVIEW_IMAGE_NODE || 'madazi-preview-node:v03',
  'spring': process.env.PREVIEW_IMAGE_SPRING || 'madazi-preview-spring:v03',
  'go': process.env.PREVIEW_IMAGE_GO || 'madazi-preview-go:v02',
  'python': process.env.PREVIEW_IMAGE_PYTHON || 'madazi-preview-python:v02',
  'runtime': process.env.PREVIEW_IMAGE || 'madazi-preview-runtime:v02',
};
const TEMPLATE_TO_IMAGE = {
  'react-node': 'node',
  'vue-node': 'node',
  'react-springboot': 'spring',
  'vue-springboot': 'spring',
  'uniapp-springboot': 'spring',
  'react-go': 'go',
  'vue-go': 'go',
  'frontend-only': 'frontend-only',
  'static': 'frontend-only',
};

// ── docker CLI 封装（execFile promisify，bulk 时输出 JSON）──────────────
function dock(args, { timeoutMs = 60000, bulk = false } = {}) {
  return new Promise((resolve, reject) => {
    const all = [...args];
    if (bulk) all.push('--format', '{{json .}}');
    execFile('docker', all, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || '').trim() || err.message;
        // 容器不存在等"预期错误"不是致命错误，让调用方按 exits=false 处理
        const e = new Error(msg);
        e.code = err.code;
        e.expectable = /\b(No such (container|object)|does not exist|not found)\b/i.test(msg);
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

export function containerName(projectId) {
  return `madazi-preview-${String(projectId).slice(0, 8)}`;
}

/** 分配宿主端口：序列递增 + 占用跳过（容器可能手动残留，跨容器避免端口冲突） */
async function allocHostPort() {
  // 收集当前已映射端口，跳过冲突
  let used = new Set();
  try {
    const out = await dock(['ps', '--filter', 'label=managed-by=madazi-server', '--format', '{{.Ports}}'], {});
    const m = String(out || '').match(/127\.0\.0\.1:(\d{4,5})->/g) || [];
    for (const s of m) {
      const p = s.match(/:(\d{4,5})->/);
      if (p) used.add(parseInt(p[1], 10));
    }
  } catch { /* 忽略 */ }
  for (let i = 0; i < 200; i++) {
    const candidate = hostPortSeq.next++;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('预览宿主端口分配失败（31000+ 段耗尽）');
}

/**
 * 创建预览容器（幂等）：已存在且运行 → 复用；存在但已退出 → 删后重建。
 * 返回 { containerName, host: '127.0.0.1', hostPort }（podName/podIP 字段对齐 preview-k8s 语义）
 */
export async function createPreviewPod(projectId, opts = {}) {
  const name = containerName(projectId);
  const shortId = projectId.slice(0, 8);
  const { projectDirName, hasFrontend, hasBackend, techStack, sourceType } = opts;

  const existing = await getPreviewPodStatus(projectId);
  if (existing.ready && existing.podIP) {
    log(`reusing running container ${name} @ ${existing.podIP}`);
    return { containerName: name, podName: name, podIP: existing.podIP, hostPort: existing.hostPort };
  }
  if (existing.exists) {
    log(`container ${name} is ${existing.phase || 'exited'}, recreate`);
    await deletePreviewPod(projectId).catch(() => {});
  }

  // 选镜像
  const normalizedTech = (techStack || '').toLowerCase().replace(/\+/g, '-');
  let imageType = 'runtime';
  if (sourceType === 'template' && normalizedTech && TEMPLATE_TO_IMAGE[normalizedTech]) {
    imageType = TEMPLATE_TO_IMAGE[normalizedTech];
  }
  const image = IMAGE_MAP[imageType] || IMAGE_MAP.runtime;
  log(`selected image ${image} (type=${imageType}, techStack=${techStack})`);

  // 源码路径：docker 挂载必须真实 host 绝对路径（source_path 由 server 按部署注入）
  const sourcePath = opts.sourcePath || opts.projectDir;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`源码目录不存在: ${sourcePath}`);
  }
  const hostPort = await allocHostPort();
  const dirName = projectDirName || path.basename(sourcePath);
  const PREVIEW_DOMAIN = ''; // 单机版无子域名：vite 用 --host 0.0.0.0 即可，无 allowedHosts 限制

  await dock([
    'run', '-d',
    '--name', name,
    '--label', 'project-id=' + projectId,
    '--label', 'managed-by=madazi-server',
    '--label', 'image-type=' + imageType,
    '--restart', 'unless-stopped',
    '-e', `PROJECT_ID=${projectId}`,
    '-e', `PROJECT_DIR=${dirName}`,
    '-e', `HAS_FRONTEND=${hasFrontend ? '1' : '0'}`,
    '-e', `HAS_BACKEND=${hasBackend ? '1' : '0'}`,
    '-e', `PREVIEW_DOMAIN=${PREVIEW_DOMAIN}`,
    // ★ 单机 HMR（2026-09-13）：浏览器经 127.0.0.1:<hostPort> 访问，vite HMR 客户端
    //   默认连 server.port(5173)——宿主机没暴露 5173 → WS 握手失败。传对外端口给
    //   entrypoint → hmr: { clientPort: <hostPort> }，客户端连 ws://127.0.0.1:<hostPort>
    //   （vite 端口兼容：clientPort≠server.port 时仍在主 server 注册 upgrade，单机可用）
    '-e', `HMR_CLIENT_PORT=${hostPort}`,
    // ★ localhost 解析固定 IPv4 优先：Node 默认 verbatim（/etc/hosts 里 ::1 在前），
    //   后端绑 0.0.0.0（IPv4）时 vite 代理连 ::1:3001 会被拒 → ECONNREFUSED（单机 docker 实测）
    '-e', 'NODE_OPTIONS=--dns-result-order=ipv4first',
    '-v', `${sourcePath}:/data/${dirName}`,
    '-p', `127.0.0.1:${hostPort}:5173`,
    image,
  ], { timeoutMs: 120000 });

  log(`created container ${name} @ 127.0.0.1:${hostPort}`);
  return { containerName: name, podName: name, podIP: `127.0.0.1:${hostPort}`, hostPort };
}

/** 删除预览容器（幂等） */
export async function deletePreviewPod(projectId) {
  const name = containerName(projectId);
  try {
    await dock(['rm', '-f', name], {});
    log(`deleted container ${name}`);
    return { deleted: name };
  } catch (e) {
    if (e.expectable) return { deleted: null };
    log(`failed to delete ${name}: ${e.message}`);
    return { deleted: null, error: e.message };
  }
}

/** 按名称删除（admin 用） */
export async function deletePreviewPodByName(name) {
  try {
    await dock(['rm', '-f', name], {});
    return { deleted: name };
  } catch (e) {
    log(`failed to delete by name ${name}: ${e.message}`);
    return { deleted: null, error: e.message };
  }
}

/**
 * 获取预览容器状态：{ exists, phase, podIP('127.0.0.1:<port>'), hostPort, ready }
 * ready = 运行中 + 实际可访问 5173（entrypoint 构建中不一定立刻通，探测兜底）
 */
export async function getPreviewPodStatus(projectId, hintPort) {
  const name = containerName(projectId);
  let raw;
  try {
    raw = await dock(['inspect', name, '--format', '{{json .State}}'], {});
  } catch (e) {
    if (e.expectable) return { exists: false, ready: false };
    throw e;
  }
  let state = {};
  try { state = JSON.parse(raw); } catch { /* 忽略 */ }
  const running = state.Running === true;
  if (!running) {
    return { exists: true, phase: state.Status || 'exited', ready: false };
  }
  // 取宿主映射端口（重启容器后端口可能变，以实际映射为准）
  let hostPort = null;
  try {
    const portOut = await dock(['port', name, '5173'], {});
    // 形如 "127.0.0.1:31002\n"
    const m = String(portOut || '').match(/:(\d{4,5})\s*$/);
    if (m) hostPort = parseInt(m[1], 10);
  } catch { /* 未映射 */ }
  const podIP = hostPort ? `127.0.0.1:${hostPort}` : null;

  // 服务级就绪探测（前端可达才算 ready）
  let ready = false;
  if (podIP) {
    const port = hintPort || hostPort || 5173;
    ready = await new Promise((resolve) => {
      const probe = http.get({ host: '127.0.0.1', port, path: '/', timeout: 5000 }, (r) => {
        r.resume();
        resolve([200, 302, 301].includes(r.statusCode || 0));
      });
      probe.on('error', () => resolve(false));
      probe.on('timeout', () => { probe.destroy(); resolve(false); });
    });
  }
  return { exists: true, phase: running ? 'Running' : 'exited', podIP, hostPort, ready };
}

/** 获取容器日志（tail 行） */
export async function getPreviewPodLogs(projectId, tail = 200) {
  const name = containerName(projectId);
  try {
    const logs = await dock(['logs', '--tail', String(tail), name], {});
    return { logs, podName: name };
  } catch (e) {
    if (e.expectable) {
      return { logs: '预览尚未启动（无预览容器），请点击「启动预览」按钮创建。\n', podName: name };
    }
    return { logs: `Failed to get logs: ${e.message}`, podName: name };
  }
}

/** 按项目 ID 前缀找运行中的预览容器（server 重启恢复用） */
export async function findPreviewPodByPrefix(prefix) {
  const list = await listPreviewPods();
  for (const p of list || []) {
    if (p.projectId && p.projectId.startsWith(prefix) && p.ready) {
      return { projectId: p.projectId, podName: p.name, podIP: p.podIP };
    }
  }
  return null;
}

/** 列出所有预览容器（admin / running 列表用） */
export async function listPreviewPods() {
  let out;
  try {
    out = await dock(['ps', '--filter', 'label=managed-by=madazi-server', '--filter', 'label=project-id'], { bulk: true });
  } catch (e) {
    log(`list failed: ${e.message}`);
    return [];
  }
  const lines = String(out || '').split('\n').filter(Boolean);
  const res = [];
  for (const line of lines) {
    let j = {};
    try { j = JSON.parse(line); } catch { continue; }
    const name = j.Names || j.name || '';
    const pid = j.Labels && (j.Labels['project-id'] || j.Labels['project-id']) || (j.labels && (j.labels['project-id'] || j.labels['project-id']));
    // docker ps --format {{json .}} 的 Labels 是 map；若无展开则从 inspect 兜底
    const status = j.Status || (j.state && j.state.Status) || '';
    const running = /^Up/.test(status);
    // ★ 宿主端口解析（127.0.0.1:31002->5173/tcp → 31002），podIP 带上端口供 recovery/URL 使用
    const portsMatch = String(j.Ports || '').match(/127\.0\.0\.1:(\d{4,5})->/);
    const hostPort = portsMatch && portsMatch[1] ? parseInt(portsMatch[1], 10) : null;
    res.push({
      name,
      projectId: pid,
      phase: running ? 'Running' : 'Exited',
      podIP: running && hostPort ? `127.0.0.1:${hostPort}` : (running ? '127.0.0.1' : null),
      hostPort,
      startedAt: j.CreatedAt || j.startedAt || null,
      image: j.Image || null,
      ready: running,
    });
  }
  return res;
}

/** 等容器完全删除（docker rm 是同步的，立即返回 true） */
export async function waitPreviewPodGone(projectId, _timeoutMs = 30000) {
  await deletePreviewPod(projectId).catch(() => {});
  return true;
}

/** 启动恢复：扫描运行中容器回填内存 Map（复用 preview.js recoverPreviewFromPod） */
export async function recoverPreviewPodsToMap() {
  try {
    const list = await listPreviewPods();
    const runs = (list || []).filter((p) => p.podIP);
    let recovered = 0;
    const { recoverPreviewFromPod } = await import('./preview.js');
    for (const p of runs) {
      const r = await recoverPreviewFromPod(p.projectId, p.podIP, p.name);
      if (r) recovered++;
    }
    if (recovered > 0) log(`recovered ${recovered} running preview container(s)`);
    return recovered;
  } catch (e) {
    log(`recover failed: ${e.message}`);
    return 0;
  }
}

/** 孤儿预览容器清扫（docker 版：container 无 label project-id 映射到内存集合则回收） */
export async function reapOrphanPreviewPods(managedProjectIds, orphanSeen, graceMs = 5 * 60 * 1000) {
  let list;
  try {
    list = await listPreviewPods();
  } catch (e) {
    log(`orphan scan failed: ${e.message}`);
    return;
  }
  const now = Date.now();
  const managed = new Set(managedProjectIds);
  for (const p of list || []) {
    if (!p.projectId) continue;
    if (managed.has(p.projectId)) { orphanSeen.delete(p.projectId); continue; }
    // 构建宽限：创建 < 15 分钟不回收（参考 preview-k8s 语义）
    const createdMs = p.startedAt ? new Date(p.startedAt).getTime() : now;
    if (now - createdMs < 15 * 60 * 1000) continue;
    if (!p.ready) continue; // 未就绪（构建中）豁免
    const firstSeen = orphanSeen.get(p.projectId);
    if (!firstSeen) {
      orphanSeen.set(p.projectId, now);
      continue;
    }
    if (now - firstSeen > graceMs) {
      try {
        await dock(['rm', '-f', p.name], {});
        log(`orphan preview container reaped: ${p.name}`);
      } catch (err) {
        log(`reap orphan ${p.name} failed: ${err.message}`);
      }
      orphanSeen.delete(p.projectId);
    }
  }
}

/** 容器内执行命令（软重启 / 构建修复 / 诊断用） */
export function execPreviewPodShell(projectId, opts = {}) {
  const { command, onData, onClose, timeoutMs } = opts;
  const name = containerName(projectId);
  const args = ['exec', '-i', name, '/bin/bash', '-lc', String(command || '')];
  // 简化：非交互 exec 封装（完整 shell 会话走 dsh-bridge，不用 docker attach）
  const cp = execFile('docker', args, { timeout: timeoutMs }, () => {});
  if (onData) { cp.stdout?.on('data', onData); cp.stderr?.on('data', onData); }
  if (onClose) cp.on('close', onClose);
  return cp;
}

export async function execPreviewPodCommand(projectId, command, opts = {}) {
  const name = containerName(projectId);
  const { timeoutMs = 30000 } = opts;
  try {
    const out = await dock(['exec', name, '/bin/bash', '-lc', String(command || '')], { timeoutMs });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 删除项目时清理容器 + 数据（docker 版：容器由 docker rm 回收；数据目录已经 host 直挂，无需额外 Pod） */
export async function cleanupProjectData(projectId, projectDirName) {
  if (!projectDirName || !/^[0-9a-fA-F-]+$/.test(projectDirName)) {
    log(`cleanupProjectData skip invalid dir: ${projectDirName}`);
    return false;
  }
  await deletePreviewPod(projectId).catch(() => {});
  return true;
}

export default { PREVIEW_MODE_DOCKER };