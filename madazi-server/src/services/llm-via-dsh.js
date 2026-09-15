// ★ P2：LLM 调用全走 dsh pod（与 server 解耦——server 只做调度，LLM 调用全在 pod 层）。
// 接口签名与 llm.js 的 chat/chatStream 一致，调用方只换 import 即可。
// 注意：temperature/max_tokens 等采样参数由 pod 内 agent 默认配置决定（与 execute-plan 链路一致）；
// options.projectId 必传（定位项目 pod + 工作目录）。
import crypto from 'crypto';
import { getDefaultConfig } from './llm.js';
import { ensureDshContainer, getDshPodAddr } from './dsh-container-k8s.js';
import { DshBridge } from './dsh-bridge.js';
import { db } from '../db/init.js';

// messages → 单文本 prompt（system 指令在前，user 需求在后，与桥的 prompt 语义一致）
function toPromptText(messages) {
  return (messages || [])
    .map((m) => {
      const roleLabel = m.role === 'system' ? '【系统指令】' : m.role === 'user' ? '【用户需求】' : '【上下文】';
      return `${roleLabel}\n${m.content}`;
    })
    .join('\n\n');
}

async function getProjectDir(projectId) {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]?.source_path) throw new Error('项目未生成（无 source_path）');
  return rows[0].source_path;
}

async function getBridge(projectId, projectDir) {
  const cfg = await getDefaultConfig();
  if (!cfg) throw new Error('No LLM config. Please configure API key in Settings.');
  await ensureDshContainer(projectId);
  const addr = await getDshPodAddr(projectId, 60_000);
  const bridge = new DshBridge({
    tcp: addr,
    cwd: projectDir,
    env: {
      DEEPSEEK_API_KEY: cfg.api_key,
      DEEPSEEK_BASE_URL: cfg.base_url,
      DEEPSEEK_MODEL: cfg.model,
      DSH_PROJECT_ID: projectId,
      DSH_TASK_ID: `doc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      DSH_WORKTREE: projectDir,
      DSH_PERMISSION_MODE: 'read-only', // 文档生成只读（PRD/PLAN/风暴问题）
      DSH_SNAPSHOT_SESSIONS_ROOT: '/tmp/dsh-sessions',
      DSH_CWD: projectDir,
    },
    spawnTimeoutMs: 60_000,
    requestTimeoutMs: 900_000, // 文档生成可长（PRD 逐章、PLAN 逐模块）
  });
  await bridge.start();
  return bridge;
}

// 与 llm.js chat 同签名：messages（system/user 数组）+ options（userId/projectId 等）
export async function chat(messages, options = {}) {
  const projectId = options.projectId;
  if (!projectId) throw new Error('[llm-via-dsh] chat 需要 options.projectId');
  const projectDir = await getProjectDir(projectId);
  const bridge = await getBridge(projectId, projectDir);
  try {
    const sessionId = await bridge.newSession();
    const { text } = await bridge.prompt(sessionId, toPromptText(messages), {});
    return text || '';
  } finally {
    if (bridge.connected) await bridge.stop().catch(() => {});
  }
}

// 与 llm.js chatStream 同签名：messages + onChunk(增量) + options。
// thinking 增量按 llm.js 语义包 <thinking>...</thinking> 标签转发（调用方 makeThinkingSplitter 兼容，零改动）
export async function chatStream(messages, onChunk, options = {}) {
  const projectId = options.projectId;
  if (!projectId) throw new Error('[llm-via-dsh] chatStream 需要 options.projectId');
  const projectDir = await getProjectDir(projectId);
  const bridge = await getBridge(projectId, projectDir);
  try {
    const sessionId = await bridge.newSession();
    const { text } = await bridge.prompt(sessionId, toPromptText(messages), {
      onChunk: (c) => { try { onChunk(c); } catch { /* 客户端断开，忽略 */ } },
      onThinking: (t) => { try { onChunk(`<thinking>${t}</thinking>`); } catch { /* 同上 */ } },
    });
    return text || '';
  } finally {
    if (bridge.connected) await bridge.stop().catch(() => {});
  }
}
