// preview-k8s.js — K8s 模式下的 preview Pod 管理
// 替代 docker-build.js 的 buildPreviewImage + runPreviewContainer
// 用预构建的 madazi-preview-runtime 镜像，项目代码通过共享 PVC 挂载

import https from 'https';
import fs from 'fs';

const NAMESPACE = process.env.K8S_NAMESPACE || 'madazi';
const PROJECTS_PVC = process.env.PROJECTS_PVC || 'madazi-projects-pvc';

// 镜像映射：按技术栈选镜像
const IMAGE_MAP = {
  'frontend-only': process.env.PREVIEW_IMAGE_FRONTEND_ONLY || 'madazi-preview-frontend-only:v02',
  // ★ 2026-09-01 短 URL 预览：全部变体重建为 v02（start.sh/entrypoint.sh 的 VITE_BASE=/）
  'node': process.env.PREVIEW_IMAGE_NODE || 'madazi-preview-node:v02',
  'spring': process.env.PREVIEW_IMAGE_SPRING || 'madazi-preview-spring:v02',
  'go': process.env.PREVIEW_IMAGE_GO || 'madazi-preview-go:v02',
  'python': process.env.PREVIEW_IMAGE_PYTHON || 'madazi-preview-python:v02',
  'runtime': process.env.PREVIEW_IMAGE || 'madazi-preview-runtime:v02',
};

// 模板技术栈 -> 镜像类型映射（tech_stack 归一化后匹配：+ -> -、小写）
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

// K8s API 客户端（裸 https，零依赖）
function k8sRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const saToken = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim();
    const caCert = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
    const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
    const port = process.env.KUBERNETES_SERVICE_PORT || 443;

    const options = {
      hostname: host,
      port: Number(port),
      path: `/api/v1/namespaces/${NAMESPACE}${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${saToken}`,
        'Content-Type': 'application/json',
      },
      ca: caCert,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          // 错误体可能是 JSON 或纯文本
          try {
            const json = JSON.parse(data);
            reject(new Error(json.message || `K8s API ${res.statusCode}`));
          } catch {
            reject(new Error(`K8s API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          return;
        }
        // 2xx：日志等纯文本接口直接返回原文；JSON 才 parse
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve(data);  // 纯文本（Pod 日志等）
        }
      });
    });
    req.on('error', reject);
    // ★ 超时保护：API server 挂起时请求不能永久 pending（30s）
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`K8s API 请求超时: ${method} ${path}`));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * 创建 preview Pod
 * @param {string} projectId - 项目 UUID
 * @param {object} opts - { projectDirName, hasFrontend, hasBackend, memoryLimit, cpuLimit }
 * @returns {Promise<{podName: string, podIP: string}>}
 */
export async function createPreviewPod(projectId, opts) {
  const shortId = projectId.slice(0, 8);
  const podName = `madazi-preview-${shortId}`;
  const { projectDirName, hasFrontend, hasBackend, memoryLimit = '512Mi', cpuLimit = '500m', techStack, sourceType } = opts;

  // 选择镜像：模板项目用对应小镜像，导入项目用通用 runtime
  // tech_stack 归一化：小写、+ -> -（DB 存 react+node，映射表 key 是 react-node）
  const normalizedTech = (techStack || '').toLowerCase().replace(/\+/g, '-');
  let imageType = 'runtime';
  if (sourceType === 'template' && normalizedTech && TEMPLATE_TO_IMAGE[normalizedTech]) {
    imageType = TEMPLATE_TO_IMAGE[normalizedTech];
  }
  const image = IMAGE_MAP[imageType] || IMAGE_MAP.runtime;
  console.log(`[preview-k8s] Selected image: ${image} (type=${imageType}, techStack=${techStack}, sourceType=${sourceType})`);

  // 复用检查：Pod 已存在且 Running -> 直接复用，不重建
  // （修复：刷新/重复 start 每次都进来，原逻辑无条件先删旧 Pod 再新建）
  const existing = await getPreviewPodStatus(projectId);
  if (existing.ready && existing.podIP) {
    console.log(`[preview-k8s] Reusing running pod: ${podName} at ${existing.podIP}`);
    return { podName, podIP: existing.podIP };
  }

  // Pod 存在但已结束（Failed/Succeeded）-> 清理后重建
  if (existing.exists) {
    console.log(`[preview-k8s] Pod ${podName} is ${existing.phase}, cleaning up then recreating...`);
    try {
      await k8sRequest('DELETE', `/pods/${podName}`);
      // ★ 等待删除真正完成，避免 object is being deleted 冲突
      for (let i = 0; i < 30; i++) {
        try {
          await k8sRequest('GET', `/pods/${podName}`);
          await new Promise(r => setTimeout(r, 1000));
        } catch {
          break; // 404 = 已删除
        }
      }
    } catch {}
  }

  const pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: NAMESPACE,
      labels: {
        app: 'madazi-preview',
        'project-id': projectId,
        'managed-by': 'madazi-server',
        'image-type': imageType,
      },
    },
    spec: {
      restartPolicy: 'Never',
      containers: [{
        name: 'preview',
        image,
        imagePullPolicy: 'Never',
        env: [
          { name: 'PROJECT_ID', value: projectId },
          { name: 'PROJECT_DIR', value: projectDirName },
          { name: 'HAS_FRONTEND', value: hasFrontend ? '1' : '0' },
          { name: 'HAS_BACKEND', value: hasBackend ? '1' : '0' },
          // ★ HMR：pv- 子域名（浏览器 WSS → quda nginx → server WS proxy → pod:5173）
          { name: 'PREVIEW_DOMAIN', value: process.env.PREVIEW_DOMAIN || '<YOUR-DOMAIN>.com' },
        ],
        ports: [
          { containerPort: 5173, name: 'vite' },
          { containerPort: 3001, name: 'backend' },
        ],
        securityContext: {
          // 跑用户项目代码：cap_drop ALL + 禁提权
          // 白名单 5 cap：内置 postgres 初始化需要 chown+降权+遍历已有 700 数据目录
          // （postgres 官方 K8s 部署同款：CHOWN DAC_OVERRIDE FOWNER SETGID SETUID）
          runAsUser: 0,
          allowPrivilegeEscalation: false,
          capabilities: {
            drop: ['ALL'],
            add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
          },
        },
        volumeMounts: [{
          name: 'projects',
          mountPath: '/data',
        }],
        resources: {
          // ★ requests 固定低值（调度宽松，多预览并行）；limits 保留实际上限（cgroup 防 OOM）
          requests: { memory: '512Mi', cpu: '100m' },
          limits: { memory: memoryLimit, cpu: cpuLimit },
        },
      }],
      volumes: [{
        name: 'projects',
        persistentVolumeClaim: { claimName: PROJECTS_PVC },
      }],
    },
  };

  await k8sRequest('POST', '/pods', pod);
  console.log(`[preview-k8s] Created pod: ${podName}`);

  // 等待 Pod Running
  const podIP = await waitForPod(podName, 120000);
  return { podName, podIP };
}

/**
 * 等待 Pod Running 并返回 podIP
 */
async function waitForPod(podName, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const pod = await k8sRequest('GET', `/pods/${podName}`);
      const phase = pod.status?.phase;
      const podIP = pod.status?.podIP;

      if (phase === 'Running' && podIP) {
        console.log(`[preview-k8s] Pod ${podName} Running at ${podIP}`);
        return podIP;
      }

      if (phase === 'Failed' || phase === 'Succeeded') {
        throw new Error(`Pod ${podName} entered ${phase}`);
      }

      // 检查容器错误
      const containerStatuses = pod.status?.containerStatuses || [];
      for (const cs of containerStatuses) {
        if (cs.state?.waiting?.reason === 'ImagePullBackOff' || cs.state?.waiting?.reason === 'ErrImagePull') {
          throw new Error(`Image pull failed: ${cs.state.waiting.message}`);
        }
        if (cs.state?.waiting?.reason === 'CrashLoopBackOff') {
          throw new Error(`Container crash loop: ${cs.state.waiting.message}`);
        }
      }
    } catch (e) {
      if (e.message.includes('Image pull') || e.message.includes('crash loop') || e.message.includes('entered')) {
        throw e;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Pod ${podName} not ready within ${timeoutMs}ms`);
}

/**
 * 删除 preview Pod
 */
export async function deletePreviewPod(projectId) {
  const shortId = projectId.slice(0, 8);
  const podName = `madazi-preview-${shortId}`;
  try {
    await k8sRequest('DELETE', `/pods/${podName}`);
    console.log(`[preview-k8s] Deleted pod: ${podName}`);
    return { deleted: podName };
  } catch (e) {
    console.warn(`[preview-k8s] Failed to delete pod ${podName}: ${e.message}`);
    return { deleted: null, error: e.message };
  }
}

/** ★ 按 Pod 名称删除（admin 接口用；对齐原 docker removePreviewContainer） */
export async function deletePreviewPodByName(podName) {
  try {
    await k8sRequest('DELETE', `/pods/${podName}`);
    console.log(`[preview-k8s] Deleted pod by name: ${podName}`);
    return { deleted: podName };
  } catch (e) {
    console.warn(`[preview-k8s] Failed to delete pod ${podName}: ${e.message}`);
    return { deleted: null, error: e.message };
  }
}

/**
 * 获取 preview Pod 状态
 */
export async function getPreviewPodStatus(projectId, hintPort) {
  const shortId = projectId.slice(0, 8);
  const podName = `madazi-preview-${shortId}`;
  try {
    const pod = await k8sRequest('GET', `/pods/${podName}`);
    // Terminating 中的 Pod phase 仍为 Running，但 deletionTimestamp 已设置 —— 视为不可用，
    // 避免 stop 后立即 start 时恢复分支误判 ready 返回假地址
    const deleting = !!pod.metadata?.deletionTimestamp;
    const containersReady = (pod.status?.containerStatuses || []).every(
      (c) => c.ready
    );
    const baseReady = !deleting && pod.status?.phase === 'Running' && !!pod.status?.podIP && containersReady;
    // ★ 服务级就绪探测：容器 ready 只代表 entrypoint 进程活着（mvn 构建中也是 ready），
    // 必须实际可访问前端/后端端口才算就绪，否则 startPreview 复用分支会误判"构建中"为 ready
    let serviceReady = false;
    if (baseReady && pod.status?.podIP) {
      serviceReady = await probeServicePorts(pod.status.podIP, hintPort);
    }
    return {
      exists: true,
      deleting: deleting,
      phase: pod.status?.phase,
      podIP: pod.status?.podIP,
      ready: baseReady && serviceReady,
    };
  } catch (e) {
    if (e.message.includes('not found')) {
      return { exists: false, ready: false };
    }
    throw e;
  }
}

/**
 * 获取 preview Pod 日志
 */
export async function getPreviewPodLogs(projectId, tail = 200) {
  const shortId = projectId.slice(0, 8);
  const podName = `madazi-preview-${shortId}`;
  try {
    const logs = await k8sRequest('GET', `/pods/${podName}/log?tailLines=${tail}`);
    return { logs, podName };
  } catch (e) {
    // Pod 不存在：返回友好提示（前端日志面板直接展示），不要暴露 K8s 原始报错
    if (e.message.includes('not found')) {
      return {
        logs: '预览尚未启动（无 preview Pod），请点击「启动预览」按钮创建。\n',
        podName,
      };
    }
    return { logs: `Failed to get logs: ${e.message}`, podName };
  }
}

/**
 * 按项目 ID 前缀找 running 的 preview Pod（server 重启后恢复现场用）
 * 返回 { projectId, podName, podIP }，找不到返回 null
 */
export async function findPreviewPodByPrefix(prefix) {
  const podList = await k8sRequest('GET', '/pods?labelSelector=app%3Dmadazi-preview');
  for (const pod of podList.items || []) {
    if (pod.status?.phase !== 'Running' || !pod.status?.podIP) continue;
    const pid = pod.metadata?.labels?.['project-id'];
    if (pid && pid.startsWith(prefix)) {
      return { projectId: pid, podName: pod.metadata.name, podIP: pod.status.podIP };
    }
  }
  return null;
}

/** ★ 列出所有 preview Pod（admin 接口用；对齐原 docker listAllPreviewContainers） */
export async function listPreviewPods() {
  const list = await k8sRequest('GET', '/pods?labelSelector=app%3Dmadazi-preview');
  const out = [];
  for (const pod of (list.items || [])) {
    // ★ 就绪 = phase Running + 非删除中 + 有 IP + 容器 ready + 服务端口探测通过（构建中容器也 ready，必须探测）
    const deleting = !!pod.metadata?.deletionTimestamp;
    const containersReady = (pod.status?.containerStatuses || []).every((c) => c.ready);
    const baseReady = !deleting && pod.status?.phase === 'Running' && !!pod.status?.podIP && containersReady;
    let ready = false;
    if (baseReady) {
      ready = await probeServicePorts(pod.status.podIP);
    }
    out.push({
      name: pod.metadata?.name,
      projectId: pod.metadata?.labels?.['project-id'],
      phase: pod.status?.phase,
      podIP: pod.status?.podIP,
      startedAt: pod.metadata?.creationTimestamp,
      image: pod.spec?.containers?.[0]?.image,
      ready,
    });
  }
  return out;
}

/** ★ 等待指定项目的 preview Pod 完全删除（k8s delete 异步：Terminating 期间 create 会撞 "object is being deleted"） */
export async function waitPreviewPodGone(projectId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pods = await listPreviewPods();
    const hit = (pods || []).filter(p => p.projectId === projectId);
    if (hit.length === 0) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting preview pod deleted: ${projectId}`);
}

/** ★ K8s 启动恢复：扫描所有 running 的 preview Pod，回填内存 Map（替代原 docker recoverOrphanedContainers） */
export async function recoverPreviewPodsToMap() {
  try {
    const list = await k8sRequest('GET', '/pods?labelSelector=app%3Dmadazi-preview');
    const pods = (list.items || []).filter(p => p.status?.phase === 'Running' && p.status?.podIP);
    let recovered = 0;
    for (const pod of pods) {
      const pid = pod.metadata?.labels?.['project-id'];
      if (!pid) continue;
      const { recoverPreviewFromPod } = await import('./preview.js');
      const r = await recoverPreviewFromPod(pid, pod.status.podIP, pod.metadata.name);
      if (r) recovered++;
    }
    if (recovered > 0) console.log(`[preview-k8s] Recovered ${recovered} running preview Pod(s) into memory Map`);
    return recovered;
  } catch (e) {
    console.warn('[preview-k8s] recoverPreviewPodsToMap failed:', e.message);
    return 0;
  }
}

/**
 * ★ 孤儿 preview Pod 清扫：server 重启后内存 Map 清空，previews 里
 * 没有的 madazi-preview Pod 无人回收。managedBySet 传当前内存 Map 的
 * projectId 集合，不在其中且超过宽限期的 Pod 直接删除。
 * orphanSeen 复用调用方的 Map（projectId -> 首见时间戳）。
 */
export async function reapOrphanPreviewPods(managedProjectIds, orphanSeen, graceMs = 5 * 60 * 1000) {
  let pods;
  try {
    const list = await k8sRequest('GET', '/pods?labelSelector=app%3Dmadazi-preview');
    pods = list.items || [];
  } catch (err) {
    console.warn('[preview-k8s] orphan scan failed:', err.message);
    return;
  }
  const now = Date.now();
  const managed = new Set(managedProjectIds);
  for (const pod of pods) {
    const pid = pod.metadata?.labels?.['project-id'];
    if (!pid) continue;
    if (managed.has(pid)) { orphanSeen.delete(pid); continue; }
    // ★ 构建宽限：Pod 创建 < 15 分钟一律不回收（mvn 首轮下载依赖可能 10+ 分钟，
    // 与 ORPHAN_GRACE_MS 无关——那是给"确认无主后快速回收"用的短窗口）
    const createdMs = new Date(pod.metadata?.creationTimestamp || now).getTime();
    if (now - createdMs < 15 * 60 * 1000) continue;
    // ★ 未就绪免疫：容器未全部 ready 的 Pod 不回收（构建中）
    const containersReady = (pod.status?.containerStatuses || []).every((c) => c.ready);
    if (!containersReady) continue;
    const firstSeen = orphanSeen.get(pid);
    if (!firstSeen) {
      orphanSeen.set(pid, now); // 首轮登记宽限（跳过刚创建尚未入 Map 的 Pod）
      console.log(`[preview-k8s] 发现孤儿 preview Pod ${pod.metadata.name}，宽限一轮`);
      continue;
    }
    if (now - firstSeen > graceMs) {
      try {
        await k8sRequest('DELETE', `/pods/${pod.metadata.name}`);
        console.log(`[preview-k8s] 孤儿 preview Pod 已回收: ${pod.metadata.name}`);
      } catch (err) {
        console.warn(`[preview-k8s] 回收孤儿 ${pod.metadata.name} 失败:`, err.message);
      }
      orphanSeen.delete(pid);
    }
  }
}

/**
 * ★ 删除项目时清理 PVC 中该项目的全部数据：
 *   1. /data/<projectDirName>                 项目主目录（源码）
 *   2. /data/<projectDirName>-wt-*            每任务一个的 git worktree（chat-tasks.js 创建）
 *   3. /data/.dsh/sessions/--app-generated-<uuid>*--    dsh-web 任务记录（消息历史 JSONL，DSH_HOME）
 *   4. /data/.dsh-sessions/--app-generated-<uuid>*--    dsh-web 会话快照（DSH_SNAPSHOT_SESSIONS_ROOT）
 * glob 以完整 36 位 UUID 为前缀，不会命中其他项目；路径均为 /data/ 绝对路径，无 rm 选项注入风险。
 * 起一次性 cleanup Pod 挂共享 PVC，rm -rf 后等待完成再回收 Pod。
 * projectDirName 必须为纯目录名（UUID），防御路径穿越。
 */
export async function cleanupProjectData(projectId, projectDirName) {
  if (!projectDirName || !/^[0-9a-fA-F-]+$/.test(projectDirName)) {
    console.warn(`[preview-k8s] cleanupProjectData 跳过非法目录名: ${projectDirName}`);
    return false;
  }
  const shortId = projectId.slice(0, 8);
  const podName = `madazi-cleanup-${shortId}`;
  const pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: NAMESPACE,
      labels: { app: 'madazi-cleanup', 'managed-by': 'madazi-server' },
    },
    spec: {
      restartPolicy: 'Never',
      containers: [{
        name: 'cleanup',
        image: IMAGE_MAP.runtime,
        imagePullPolicy: 'Never',
        command: ['sh', '-c',
          `rm -rf /data/${projectDirName} /data/${projectDirName}-wt-*` +
          ` /data/.pgdata/${projectDirName}` +
          ` /data/.dsh/sessions/--app-generated-${projectDirName}*` +
          ` /data/.dsh-sessions/--app-generated-${projectDirName}*`],
        volumeMounts: [{ name: 'projects', mountPath: '/data' }],
      }],
      volumes: [{
        name: 'projects',
        persistentVolumeClaim: { claimName: PROJECTS_PVC },
      }],
    },
  };

  try {
    // 幂等：先删可能残留的同名 cleanup pod
    try { await k8sRequest('DELETE', `/pods/${podName}`); } catch {}
    await k8sRequest('POST', '/pods', pod);
    // 轮询等待 Succeeded / Failed（最多 90s，rm -rf 一般秒级）
    const deadline = Date.now() + 90 * 1000;
    let phase = '';
    while (Date.now() < deadline) {
      try {
        const p = await k8sRequest('GET', `/pods/${podName}`);
        phase = p.status?.phase || '';
        if (phase === 'Succeeded' || phase === 'Failed') break;
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    const ok = phase === 'Succeeded';
    console.log(`[preview-k8s] cleanup ${projectDirName} → ${phase || 'timeout'}`);
    if (phase === 'Failed') {
      try {
        const logs = await k8sRequest('GET', `/pods/${podName}/log?tailLines=5`);
        console.warn(`[preview-k8s] cleanup pod 日志: ${logs}`);
      } catch {}
    }
    // 回收 cleanup pod
    try { await k8sRequest('DELETE', `/pods/${podName}`); } catch {}
    return ok;
  } catch (err) {
    console.warn(`[preview-k8s] cleanupProjectData 失败:`, err.message);
    try { await k8sRequest('DELETE', `/pods/${podName}`); } catch {}
    return false;
  }
}


/**
 * ★ 服务级就绪探测：尝试访问 preview Pod 的前端/后端端口（5173 vite / 8080 spring / 3001 node），
 * 任一可访问（HTTP < 500）即视为服务就绪。探测失败全部超时 → 未就绪（构建中）。
 * hintPort：导入项目端口自适应——Pod 内 watcher 探测到的实际监听端口（.preview-port），优先探测
 */
async function probeServicePorts(podIP, hintPort) {
  const ports = [...new Set([hintPort, 5173, 8080, 3001].filter(p => Number.isInteger(p)))];
  for (const port of ports) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://${podIP}:${port}/`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status < 500) return true;
    } catch {
      // 端口未就绪，试下一个
    }
  }
  return false;
}
