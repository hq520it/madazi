/**
 * dsh-container-k8s.js - 每项目常驻 dsh 沙箱 Pod 生命周期管理（K3s）
 *
 * 与 dsh-container.js（docker 版）API 完全对齐（drop-in 替换）：
 *   ensureDshContainer / isContainerRunning / removeForProject / containerName
 * USE_K8S!=1 时全部委托 dsh-container.js（老 docker 路径）。
 *
 * 架构（方案 B：TCP-stdio 桥，零 SPDY/exec 依赖）：
 *   server --net.connect PodIP:7001--> dsh Pod [dsh-bridge-tcp.js -> dsh-agent stdio]
 *   Pod 常驻，dsh-agent 每连接一个进程，断开即杀。
 *
 * 卷（与 server Pod 同 PVC 同挂载点，worktree 跨容器可见可写）：
 *   - /app/generated:rw  ← madazi-projects-pvc（git worktree / 项目主仓）
 *   - /tmp /run          ← emptyDir Memory（tmpfs）
 *
 * 沙箱红线（docker run 参数 -> K8s 等价物）：
 *   --cap-drop ALL          -> capabilities.drop [ALL]
 *   no-new-privileges       -> allowPrivilegeEscalation false
 *   --read-only             -> readOnlyRootFilesystem true（/tmp /run tmpfs 可写）
 *   --memory 2g --cpus 1    -> resources.limits
 *   --pids-limit 100        -> 无 Pod 级等价物（podPidsLimit 是 kubelet 全局项），纵深防御降级，可接受
 *   网络                     -> Pod 网络（可出站调模型 API，无入站暴露，7001 仅 PodIP 直连）
 */
import https from 'https';
import fs from 'fs';
import path from 'path';
import { PROJECTS_ROOT, DSH_HOME } from '../config/paths.js';

export const CONTAINER_PREFIX = 'madazi-dsh-';
export const IMAGE = process.env.DSH_IMAGE || 'madazi-dsh:latest';
export const IDLE_TIMEOUT_MS = Number(process.env.DSH_IDLE_TIMEOUT_MS || 30 * 60_000);
const REAP_INTERVAL_MS = Number(process.env.DSH_REAP_INTERVAL_MS || 10 * 60_000);
const NAMESPACE = process.env.K8S_NAMESPACE || 'madazi';
const PROJECTS_PVC = process.env.PROJECTS_PVC || 'madazi-projects-pvc';
const DSH_TCP_PORT = parseInt(process.env.DSH_TCP_PORT || '7001', 10);
// Pod 内挂载点与 server 同源（k8s 下 PROJECTS_ROOT=/app/generated，DSH_HOME=/app/generated/.dsh）
const K8S_PROJECTS_MNT = PROJECTS_ROOT;
const K8S_DSH_HOME = DSH_HOME;
const K8S_PROFILE_DIR = path.join(K8S_DSH_HOME, 'profile');

// K8s ServiceAccount 认证（Pod 内自动注入）
const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SA_CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
const K8S_API_HOST = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
const K8S_API_PORT = process.env.KUBERNETES_SERVICE_PORT || '443';

let k8sToken = null;
let k8sCa = null;
try {
  k8sToken = fs.readFileSync(SA_TOKEN_PATH, 'utf8').trim();
  k8sCa = fs.readFileSync(SA_CA_PATH);
} catch {
  /* 非 K8s 环境：委托 legacy */
}

const log = (...args) => console.log('[dsh-container-k8s]', ...args);

// projectId -> { lastUsed: number }
const podMeta = new Map();

export function containerName(projectId) {
  return `${CONTAINER_PREFIX}${projectId}`;
}

// ★ 插件市场重启按钮复用：label 选中 dsh-web pod → DELETE（deployment 自动重建）
export function k8sRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: K8S_API_HOST,
      port: K8S_API_PORT,
      path: `/api/v1/namespaces/${NAMESPACE}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${k8sToken}`,
        'Content-Type': 'application/json',
      },
      ca: k8sCa,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`K8s ${method} ${path} -> ${res.statusCode}: ${parsed.message || data.slice(0, 200)}`));
        } catch (e) {
          reject(new Error(`K8s ${method} ${path} 响应解析失败: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    // ★ 超时保护：API server 挂起时请求不能永久 pending（30s）
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`K8s ${method} ${path} 请求超时`));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function touch(projectId) {
  podMeta.set(projectId, { lastUsed: Date.now() });
}

/** Pod 是否 Running 且容器 ready（Terminating 中的 Pod 视为不可用——deletionTimestamp 存在即不可复用） */
export async function isContainerRunning(projectId) {
  try {
    const pod = await k8sRequest('GET', `/pods/${containerName(projectId)}`);
    if (pod.metadata?.deletionTimestamp) return false; // ★ Terminating 竞态：kubectl delete --wait=false 后 30s 内 Pod phase 仍 Running，必须视为不可用
    if (pod.status?.phase !== 'Running') return false;
    const cs = pod.status?.containerStatuses?.[0];
    return !!(cs && cs.ready && cs.state?.running);
  } catch (err) {
    if (String(err.message).includes('404')) return false;
    throw err;
  }
}

/** 等 Pod Running + 分配 PodIP（ensure 后调用，最多 waitMs） */
export async function getDshPodAddr(projectId, waitMs = 60_000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      const pod = await k8sRequest('GET', `/pods/${containerName(projectId)}`);
      if (pod.metadata?.deletionTimestamp) continue; // Terminating 中不可用，继续等
      const ip = pod.status?.podIP;
      const ready = pod.status?.phase === 'Running' && pod.status?.containerStatuses?.[0]?.ready;
      if (ready && ip) return { host: ip, port: DSH_TCP_PORT };
      // Failed/ImagePullBackOff 直接失败不傻等
      const reason = pod.status?.containerStatuses?.[0]?.state?.waiting?.reason;
      if (reason === 'ImagePullBackOff' || reason === 'ErrImageNeverPull' || pod.status?.phase === 'Failed') {
        throw new Error(`dsh Pod 启动失败: ${pod.status?.phase} ${reason || ''}`);
      }
    } catch (err) {
      if (!String(err.message).includes('404')) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`dsh Pod ${containerName(projectId)} ${waitMs}ms 内未就绪`);
}

function podSpec(projectId) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: containerName(projectId),
      labels: { app: 'madazi-dsh', 'madazi-project': projectId },
    },
    spec: {
      restartPolicy: 'Never', // 生命周期由 server 管理，崩溃不自动重启（ensure 时重建）
      // ★ 插件市场前提（2026-08-19）：PVC 首启把镜像固化 profile 复制到共享目录（幂等）
      initContainers: [
        {
          name: 'profile-init',
          image: IMAGE,
          imagePullPolicy: 'Never',
          command: ['/bin/sh', '-c'],
          args: [
            `mkdir -p ${K8S_PROFILE_DIR} && [ -f ${K8S_PROFILE_DIR}/cordis.yml ] || cp -r /opt/dsh-profile/. ${K8S_PROFILE_DIR}/`,
          ],
          volumeMounts: [{ name: 'projects', mountPath: K8S_PROJECTS_MNT }],
        },
      ],
      containers: [
        {
          name: 'dsh',
          image: IMAGE,
          imagePullPolicy: 'Never', // 强制本地镜像
          ports: [{ containerPort: DSH_TCP_PORT }],
          // ★ P1.5 旁路：内桥直写 Redis + 直落 DB——与 server 同一 configmap/secret（envFrom 命名引用，不暴露值）
          envFrom: [
            { configMapRef: { name: 'madazi-config' } },
            { secretRef: { name: 'madazi-secret' } },
          ],
          env: [
            { name: 'HOME', value: '/tmp' },
            // ★ 会话持久化根挂 PVC（跨 pod 重建存活）：resume 会话恢复的前提
            { name: 'DSH_SNAPSHOT_SESSIONS_ROOT', value: `${K8S_DSH_HOME}-sessions` },
          ],
          securityContext: {
            // 与 docker 版等价：root + cap_drop ALL + 禁提权 + 只读根文件系统
            // （server Pod 以 root 写 PVC worktree，UID 1000 会写不进 root 属主目录）
            runAsNonRoot: false,
            runAsUser: 0,
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ['ALL'] },
          },
          resources: {
            requests: { memory: '256Mi', cpu: '250m' },
            limits: { memory: '2Gi', cpu: '1' },
          },
          volumeMounts: [
            { name: 'projects', mountPath: K8S_PROJECTS_MNT },
            // ★ /app 整目录 = PVC 共享 profile（cordis.yml + node_modules 同目录）：
            //   插件市场 pnpm 安装/启停直接生效，agent 进程下次启动自动加载新配置
            { name: 'projects', mountPath: '/app', subPath: '.dsh/profile' },
            { name: 'tmp', mountPath: '/tmp' },
            { name: 'run', mountPath: '/run' },
          ],
        },
      ],
      volumes: [
        { name: 'projects', persistentVolumeClaim: { claimName: PROJECTS_PVC } },
        { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '256Mi' } },
        { name: 'run', emptyDir: { medium: 'Memory', sizeLimit: '16Mi' } },
      ],
    },
  };
}

/** 确保项目常驻 dsh Pod Running（幂等） */
export async function ensureDshContainer(projectId) {
  if (await isContainerRunning(projectId)) {
    touch(projectId);
    return;
  }
  // 不存在 / 非 Running（Failed、CrashLoopBackOff、Terminating 残骸）-> 删干净重建
  try {
    await k8sRequest('DELETE', `/pods/${containerName(projectId)}`);
    // Terminating 中的 Pod 同名创建会冲突，等它消失（最多 15s）
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        await k8sRequest('GET', `/pods/${containerName(projectId)}`);
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        break; // 404 = 已消失
      }
    }
  } catch { /* 不存在 */ }
  try {
    await k8sRequest('POST', '/pods', podSpec(projectId));
    touch(projectId);
    log(`persistent pod created: ${containerName(projectId)}`);
  } catch (err) {
    // 409：同名 Pod 仍在 Terminating（删除未完成）——等它消失后重试（最多 3 次 × 5s）
    if (/409|being deleted|already exists/.test(err.message || '')) {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          await k8sRequest('POST', '/pods', podSpec(projectId));
          touch(projectId);
          log(`persistent pod created (after 409 retry): ${containerName(projectId)}`);
          return;
        } catch (e2) {
          if (!/409|being deleted|already exists/.test(e2.message || '')) {
            throw new Error(`无法启动 dsh 沙箱 Pod: ${e2.message}`);
          }
        }
      }
    }
    log(`failed to create pod for ${projectId}:`, err.message);
    throw new Error(`无法启动 dsh 沙箱 Pod: ${err.message}`);
  }
}

/** 项目删除时清理 Pod */
export async function removeForProject(projectId) {
  podMeta.delete(projectId);
  try {
    await k8sRequest('DELETE', `/pods/${containerName(projectId)}`);
    log(`pod removed: ${containerName(projectId)}`);
  } catch { /* 不存在 */ }
}

/** 空闲回收：扫描全部 madazi-dsh-* Pod，超时删除（孤儿首轮登记宽限一个周期） */
async function reapIdle() {
  let pods;
  try {
    const list = await k8sRequest('GET', '/pods?labelSelector=app%3Dmadazi-dsh');
    pods = list.items || [];
  } catch (err) {
    console.error('[dsh-container-k8s] reap scan failed:', err.message);
    return;
  }
  const now = Date.now();
  for (const pod of pods) {
    const projectId = pod.metadata?.labels?.['madazi-project'];
    if (!projectId) continue;
    const meta = podMeta.get(projectId);
    if (!meta) {
      podMeta.set(projectId, { lastUsed: now });
      continue;
    }
    if (now - meta.lastUsed > IDLE_TIMEOUT_MS) {
      try {
        await k8sRequest('DELETE', `/pods/${pod.metadata.name}`);
        log(`idle pod reaped: ${pod.metadata.name} (idle ${Math.round((now - meta.lastUsed) / 1000)}s)`);
      } catch (err) {
        console.warn(`[dsh-container-k8s] reap failed for ${pod.metadata.name}:`, err.message);
      }
      podMeta.delete(projectId);
    }
  }
}

setInterval(() => { reapIdle().catch(() => {}); }, REAP_INTERVAL_MS).unref();
