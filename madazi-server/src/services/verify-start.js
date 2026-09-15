// 导入项目「验证启动」闭环编排器：
//   启动预览 → 服务级健康判定（端口探活）→ 失败抓日志派 AI 修复任务 → 清理环境重试（≤3 轮）
// 防护：项目级互斥锁 / 相同错误签名提前终止 / 客户端断连中止 / 修复任务超时
import crypto from 'crypto';
import { db } from '../db/init.js';
import { startPreview, stopPreview } from './preview.js';
import { getPreviewPodStatus, getPreviewPodLogs, waitPreviewPodGone } from './preview-k8s.js';
import { createTask, subscribeTask, cancelTask } from './chat-tasks.js';
import { RUNTIME_CONTRACT } from './runtime-contract.js';

const MAX_ROUNDS = 3;                 // 重试上限（拍板：固定 3 轮，不做配置项）
const READY_TIMEOUT_MS = 150 * 1000;  // 单轮等 Pod 服务就绪上限
const FIX_TIMEOUT_MS = 10 * 60 * 1000; // 单轮 AI 修复任务上限
const LOG_TAIL = 150;                  // 喂给 AI 的日志尾部行数

const running = new Set(); // projectId 互斥锁（模块级，server 单副本够用）

export function isVerifying(projectId) {
  return running.has(projectId);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 错误签名：剥时间戳/数字后取错误行尾部，用于「同错不重试」判定
function errorSignature(logs) {
  const norm = String(logs || '')
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '')
    .replace(/\d+/g, 'N')
    .split('\n')
    .filter((l) => /error|failed|exception|cannot|not found|ERR!|panic/i.test(l))
    .slice(-8)
    .join('\n');
  return crypto.createHash('md5').update(norm || String(logs || '').slice(-500)).digest('hex');
}

function buildFixPrompt(logs) {
  const tail = String(logs || '').split('\n').slice(-80).join('\n');
  return [
    '当前项目是从外部导入的，预览容器启动失败。请分析下面的启动日志，修复问题，使服务能正常启动。',
    '',
    RUNTIME_CONTRACT,
    '',
    '要求：',
    '1. 优先修依赖声明（package.json/requirements.txt/pom.xml 等）与启动配置；项目根目录的 .preview-config.json 描述预览容器如何安装依赖和启动，如配置有误请一并修正',
    '2. 只在必要时改业务代码，且只做让服务能启动的最小改动，不要重构',
    '3. 常见原因：依赖缺失/版本冲突、启动命令不对、端口不对、环境变量缺失（可用合理默认值兜底）',
    '4. 改完不需要你自己启动验证，平台会自动重试',
    '',
    '启动日志（尾部）：',
    '```',
    tail,
    '```',
  ].join('\n');
}

// 等修复任务到终态（超时/中止也会返回）
function waitFixTask(projectId, taskId, isAborted, emit) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.unsubscribe();
      resolve(r);
    };
    const timer = setTimeout(() => {
      cancelTask(projectId, taskId).catch(() => {});
      done({ status: 'timeout' });
    }, FIX_TIMEOUT_MS);
    const sub = subscribeTask(projectId, taskId, {
      onChunk: (text) => { /* 修复过程不回放给 SSE（太长），只留状态行 */ },
      onDone: (r) => done({ status: (r && r.status) || 'completed' }),
    });
    if (!sub.task) {
      clearTimeout(timer);
      resolve({ status: 'not_found' });
    }
  });
}

async function setBuildStatus(projectId, status) {
  try {
    await db.query('UPDATE projects SET build_status = $1, updated_at = NOW() WHERE id = $2', [status, projectId]);
  } catch { /* 状态落库失败不阻断 */ }
}

/**
 * 验证启动主流程。
 * @param emit 日志回调（SSE 单行文本）
 * @param isAborted 客户端断连判定
 * @returns { ok: boolean, reason?: string }
 */
export async function verifyStart({ projectId, userId, emit, isAborted }) {
  running.add(projectId);
  try {
    await setBuildStatus(projectId, 'verifying');
    let prevSig = null;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (isAborted()) return { ok: false, reason: 'aborted' };
      emit(`\n━━━ 第 ${round}/${MAX_ROUNDS} 轮 ━━━`);
      emit('启动预览容器…');
      const r = await startPreview(projectId, userId);
      if (r.status === 'limit_reached' || r.status === 'global_limit_reached') {
        emit('❌ 预览并发数已达上限，请先停止其他预览再试');
        await setBuildStatus(projectId, 'start_failed');
        return { ok: false, reason: 'limit' };
      }

      // 等服务级就绪（容器 ready + 端口探活）
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let ready = false;
      while (Date.now() < deadline) {
        if (isAborted()) return { ok: false, reason: 'aborted' };
        const st = await getPreviewPodStatus(projectId).catch(() => ({ ready: false }));
        if (st.ready) { ready = true; break; }
        await sleep(3000);
      }
      if (ready) {
        emit('✅ 服务已就绪，验证通过（预览保持运行，可直接打开预览）');
        await setBuildStatus(projectId, 'ready');
        return { ok: true };
      }

      // 未就绪：抓日志 → 同错判定 → 派 AI 修复
      const { logs } = await getPreviewPodLogs(projectId, LOG_TAIL);
      const sig = errorSignature(logs);
      if (sig === prevSig) {
        emit('⚠️ 与上一轮错误完全相同，AI 修复未生效，提前终止（避免空烧配额）');
        break;
      }
      prevSig = sig;
      if (round === MAX_ROUNDS) break;

      emit('❌ 启动未就绪，已抓取日志，AI 正在分析修复（最长 10 分钟）…');
      const task = await createTask({ projectId, userId, message: buildFixPrompt(logs) });
      emit(`修复任务 ${task.id.slice(0, 8)} 已派发`);
      const result = await waitFixTask(projectId, task.id, isAborted, emit);
      if (isAborted()) return { ok: false, reason: 'aborted' };
      emit(result.status === 'completed' ? '✅ AI 修复完成' : `⚠️ 修复任务结束（${result.status}），继续重试`);

      // 清理 Pod，干净环境重试（脏容器会干扰判定）
      emit('清理预览环境，准备重试…');
      await stopPreview(projectId).catch(() => {});
      await waitPreviewPodGone(projectId, 30000).catch(() => {});
    }
    await setBuildStatus(projectId, 'start_failed');
    emit(`\n❌ ${MAX_ROUNDS} 轮内未能启动。可根据上方日志手动修复，或再次点击「验证启动」。`);
    return { ok: false, reason: 'exhausted' };
  } finally {
    running.delete(projectId);
  }
}
