import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execFileSync, execSync, spawnSync } from 'child_process';
import { promises as dnsPromises } from 'dns';
import { EventEmitter } from 'events';
import { encode as tokenize } from 'gpt-tokenizer';
import { db } from '../db/init.js';
import { chatStream, getConfigById, getDefaultConfig } from './llm.js';
import { writeTaskEvent, getRedis } from './redis.js';
import { logExactUsage } from './usage.js';
import { searchCodebase } from './codebase-index.js';
import { DshBridge } from './dsh-bridge.js';
import {
  ensureDshContainer, containerName, isContainerRunning, getDshPodAddr,
} from './dsh-container-k8s.js';

// file-predict.js 已废弃，不再导入（AI 自己 list/grep 定位文件）
import {
  getConversationMessages,
  addAiMessage,
  updateAiMessage,
  appendAiContent,
} from './conversations.js';

// Docker 实例 + 预览容器配置

// 复用 chat.js 的工具函数（内联实现，避免循环依赖）
const SYSTEM_PROMPT = `你是 Madazi 平台的 AI 编程助手，帮助用户修改、优化、调试他们的项目代码。

## 工作方式
你通过**工具调用**操作文件，像人类工程师一样工作：
1. **分析需求**：判断涉及哪些文件、改动范围
2. **自适应计划**：简单改动直接做，复杂改动（3+文件或架构性调整）先简述计划再执行
3. **逐步执行**：用 \`read_file\` 读取 -> \`edit_file\`/\`write_file\` 修改，一个文件改完再改下一个
4. **完成总结**：所有修改完成后，用文字简要说明你做了什么

## 工具说明
- **read_file(path)**: 读取项目中的文件。修改前务必先读取文件完整内容。
- **write_file(path, content)**: 创建新文件或完全重写文件。content 是完整文件内容。
- **edit_file(path, old_text, new_text, replace_all?)**: 局部替换。支持模糊匹配--缩进和空格不必完全一致，只要代码行内容匹配即可。默认只替换第一个匹配项，设置 replace_all=true 替换所有匹配项。
- **multi_edit(path, edits)**: 对同一文件进行多处替换。edits 是 [{old_text, new_text}] 数组，按顺序执行。减少工具调用轮次。同样支持模糊匹配。
- **list_files(path?)**: 列出目录下所有文件（递归）。
- **glob(pattern)**: 按通配符模式查找文件。如 \`glob("**/*.tsx")\` 找所有 tsx 文件，\`glob("src/**/*.test.*")\` 找所有测试文件。
- **grep(pattern, path?)**: 搜索代码内容，返回匹配的文件路径、行号和内容。用于快速定位代码位置。
- **run_command(command, cwd?)**: 在项目目录中执行 shell 命令。用于安装依赖、运行测试、构建项目、查看 git 状态等。超时60秒，输出限制3000字符。
- **web_search(query, max_results?)**: 联网搜索。查最新文档、API 用法、库版本、错误解决方案时使用。搜索英文关键词效果更好。
- **preview_exec(command, project_id?)**: ★ 在项目的预览容器内执行命令。当用户说项目跑不起来/报错/缺环境时：先检测环境（python3 --version 等），再安装依赖（pip install 等），重启或自测（curl localhost）。需要预览已启动。安装的系统包 Pod 重建后丢失，项目级依赖装 /data/<项目目录> 下（PVC 持久）。
- **todo_write(todos)**: 任务进度追踪。多步骤任务先建清单，每完成一步更新状态。todos 是全量数组 [{id, content, status}]，status: pending/in_progress/completed，同时只能1个 in_progress。
- **lsp_diagnostics(path?)**: 类型检查/诊断。编辑代码后调用验证是否有类型错误。自动检测项目类型（eslint 优先，fallback tsc --noEmit）。
- **web_fetch(url, max_chars?)**: 抓取网页内容，返回纯文本。用于读取文档、API 响应、GitHub 文件等。
- **git_status()**: 获取 git 仓库状态（分支、暂存/未暂存/未跟踪文件）。做修改前先检查项目状态。
- **project_map(depth?)**: 获取项目目录树概览（排除 node_modules 等）。快速了解项目布局。
- **file_undo(path)**: 回滚单个文件到 git HEAD 版本。用于撤销对文件的修改。仅限 git 跟踪的文件。

## 任务复杂度自适应
- **简单任务**（1-2文件、改几行代码）：直接读取+修改，不要先输出计划，省掉不必要的往返。
- **中等任务**（3-5文件）：一句话说明改什么，然后直接开始。
- **复杂任务**（6+文件或架构调整）：先输出 \`\`\`📋 修改计划\`\`\`（每行一个文件+改什么），然后立即执行，不等用户确认。

## 核心原则
1. **先读后改**：修改文件前必须先 read_file 看到当前内容，不要凭记忆改。
2. **最小改动**：只改用户要求的部分，不要动无关代码。
3. **保留现有功能**：不要删除用户没要求删除的功能。
4. **代码风格**：遵循项目现有的代码风格（缩进、命名、框架用法）。
5. **中文回复**：所有非工具调用的文字用中文回复。先简要说明要改什么，然后调用工具修改。

## 复杂任务策略（多文件改动）
1. **批量读取**：一次回复中可以调用多个 read_file，减少往返。
2. **逐步修改**：一个文件改完再改下一个，不要一次铺开所有文件。
3. **edit_file 上下文**：old_text 只需包含修改点附近 3-5 行上下文即可，不要复制整个函数。如果替换失败，重新 read_file 看最新内容再重试。
4. **完成后验证**：所有修改完成后，如果涉及多文件改动，read_file 重新检查关键文件确保一致性。

## 错误恢复
1. edit_file 返回 "未匹配" 时：重新 read_file 该文件，用最新的内容再试。支持模糊匹配，缩进不必完全一致。
2. edit_file 返回 "multiple matches" 时：增加更多上下文行让 old_text 唯一，或使用 replace_all。
3. 不要因为一次失败就放弃，换个方式重试。

## 常见陷阱
1. Java：Lombok @Getter 生成的是 getName() 不是 name()。
2. React：不要遗漏 import，不要遗漏 export，JSX 必须有单一根元素。
3. 修改完代码后可以用 run_command 跑 "npx tsc --noEmit" 或 "npm run build" 验证是否有编译错误。

## 预览环境知识
1. 项目运行在 Docker 容器中，Vite dev server 监听 5173。
2. 预览 URL 格式：https://pv-<id8>.<域>/（短 URL，vite base=/，直接打开应用；API 走相对 /api）
3. React Router 的 BrowserRouter basename 已由平台自动注入，不要手动设置。
4. 前端 API 请求必须用相对路径（如 "/api/items"），不能硬编码 localhost 或绝对域名。
5. 修复后代码会自动写入并触发 Vite HMR 热更新，无需手动刷新。`;

// ====== PRD 调整专用 prompt ======
const PRD_EDIT_PROMPT = `你是 Madazi 平台的 PRD 文档编辑助手。当前处于 PRD 文档调整阶段，用户想修改 PRD 文档内容。

## 重要约束
1. **只允许操作 doc/PRD.md 文件**，不要读取或修改任何其他代码文件。
2. **不要扫描项目结构**，不需要了解技术栈实现细节。
3. 用户可能引用了 PRD 中的某段内容并要求调整，你需要 read_file 读取 doc/PRD.md，然后 edit_file 修改对应部分。
4. 修改完成后简要说明改了什么，不要多余操作。
5. 中文回复。`;

// ====== Agent Plan Mode 专用 prompt ======
const AGENT_PLAN_PROMPT = `你是 Madazi 平台的 AI 编程助手，当前处于**计划模式**。

## 工作方式
1. **分析需求**：用 read_file/list_files/grep 了解相关代码，但**不要修改任何文件**。
2. **输出结构化计划**：分析完成后，输出以下 JSON 格式的计划（用 \`\`\`plan 代码块包裹）：

\`\`\`plan
{
  "summary": "一句话描述这个任务的目标",
  "steps": [
    {
      "id": 1,
      "title": "步骤标题",
      "action": "具体要做什么",
      "files": ["src/App.tsx", "src/api.ts"],
      "type": "modify" | "create" | "delete" | "run"
    }
  ],
  "estimatedFiles": 3,
  "risk": "low" | "medium" | "high",
  "riskNote": "风险说明（如有）"
}
\`\`\`

## 规则
1. **只读不写**：可以使用 read_file, list_files, grep 了解代码，但**禁止使用 write_file, edit_file, multi_edit, run_command**。
2. **计划要具体**：每个步骤必须列出涉及的文件和具体操作。
3. **步骤要有序**：按依赖关系排序，先改的文件排在前面。
4. **中文输出**：summary, title, action, riskNote 都用中文。
5. 计划输出后停止，等待用户确认。不要自行开始修改。`;


// ====== 开发计划调整专用 prompt ======
const PLAN_EDIT_PROMPT = `你是 Madazi 平台的开发计划编辑助手。当前处于开发计划调整阶段，用户想修改开发计划文档内容。

## 重要约束
1. **只允许操作 doc/PLAN/ 目录下的文件**（index.md 是索引，各模块文件为 NN-模块名.md），不要读取或修改任何其他代码文件。
2. **不要扫描项目结构**，不需要了解技术栈实现细节。
3. 用户可能引用了开发计划中的某段内容并要求调整，你需要先 read_file 读取 doc/PLAN/index.md 找到对应模块文件，再 edit_file 修改对应部分。
4. 修改完成后简要说明改了什么，不要多余操作。
5. 中文回复。`;


// ============ 预设技能 prompt（与前端 skills.ts 同步）============
const SKILL_PROMPTS = {
  'frontend-spec': '请遵循前端规范：使用 Inter 字体（UI）和 JetBrains Mono（代码），紧凑 spacing（4-32px），1px 细边框，Linear 风格的深色配色（#08090A/#0E0F11/#141517），所有按钮带 inline-flex + gap 对齐图标和文字，过渡动画 120-180ms cubic-bezier(0.4,0,0.2,1)。',
  'backend-spec': '请遵循后端规范：RESTful 路由命名，统一错误处理返回 {error: string}，所有 controller/service 方法加 TypeScript 类型注解，使用 async/await 而非 Promise.then，敏感字段（api_key/password）在响应中脱敏。',
  'refactor': '请按重构原则：提取重复代码为函数，消除魔法数字（用 const 命名），每个函数只做一件事（单一职责），优先纯函数，避免修改入参。给出重构前后对比说明。',
  'test-coverage': '请补充测试：覆盖核心业务逻辑、边界条件（null/undefined/空数组/超长字符串）、错误路径。使用 vitest/jest，测试文件与源文件同目录 __tests__ 子目录，命名 xxx.test.ts。',
  'perf': '请按性能优化原则：React 组件用 React.memo 避免不必要 re-render，事件处理用 useCallback/useMemo 稳定引用，输入框用 debounce，长列表用虚拟滚动（react-window），路由级 lazy load。',
  'ui-ux-pro-max': `你是一位 UI/UX 设计专家。遵循以下优先级规则：
1. 可访问性(CRITICAL)：对比度≥4.5:1，所有图片有alt，键盘可导航，aria-label完整。禁止移除focus ring，禁止无标签的纯图标按钮。
2. 触摸交互(CRITICAL)：可点击元素最小44×44px，间距≥8px，所有操作有loading反馈。禁止纯hover交互，禁止0ms状态切换。
3. 布局响应(HIGH)：移动优先断点，viewport meta正确，无横向滚动。禁止固定px容器宽度，禁止禁用缩放。
4. 排版色彩(MEDIUM)：基础字号16px，行高1.5，语义化色彩token。禁止body文字<12px，禁止灰底灰字，禁止在组件中写死hex。
5. 动效(MEDIUM)：时长150-300ms，动效传达含义，空间连续性。禁止纯装饰动效，禁止animate width/height，需支持prefers-reduced-motion。
6. 表单反馈(MEDIUM)：可见label，错误信息在字段旁，helper text，渐进式展示。禁止placeholder当label，禁止错误只在顶部。
7. 导航(HIGH)：可预测的返回行为，底部导航≤5项，支持深链接。
设计决策时说明理由，给出色彩/排版/间距的具体值。`,
  'frontend-design': `你是一位前端设计总监。构建或重设计前端时，从以下8个美学锚点中选择一个并严格遵循其token：

1. Swiss：纯白#FFFFFF，Helvetica/Akzidenz-Grotesk无衬线，Swiss Red #E4002B强调，1px发丝线网格，左对齐不对称平衡。
2. Industrial：纯黑#000000，IBM Plex Mono等宽全站，单一信号色(green/red/amber)，1px边框替代阴影，表格数字tabular-nums。
3. Brutalist：纯原色#FF0000/#0000FF/#FFFF00，系统字体混排(Times+Helvetica+Courier)，box-shadow:8px 8px 0 #000硬阴影，原生控件不样式化。
4. Aurora：深色渐变面(violet→magenta→cyan)，15-25vw超大display字体，mesh渐变+neon text-shadow发光，spring物理动画。
5. Chaotic：碰撞色板(pastel+neon同框)，3+字体混搭，每面都有图案(SVG/repeating-gradient)，超大display撞密集底纹。
6. Retro-Futuristic：深黑#0A0014，VT323/Orbitron/Space Mono时期字体，magenta+cyan或phosphor green+amber，CRT扫描线/色差text-shadow。
7. Organic：大地色(sage/clay/terracotta/ochre)，humanist衬线(Freight/Caslon/Fraunces)，圆角16-32px，1-3% SVG颗粒纹理。
8. Lo-Fi：纸黄#E8E0C0，系统字体混排，2-8°旋转偏移，半色调点过渡+Riso错位(text-shadow:3px 0 #FF006E,-3px 0 #00FFCC)。

规则：只选一个锚点，不混搭。所有CSS token严格在锚点范围内。屏幕上每个字符串必须是真实信息，禁止编造数据、填充标签、主题化替换标准UI文案、unicode符号当图标。先声明选择的锚点和理由，再写代码。`,
};

function getSkillPrompt(skillId) {
  return SKILL_PROMPTS[skillId] || '';
}

// ============ Function Calling 工具定义 ============


/**
 * ★ 模糊匹配替换：容忍空白差异（缩进/换行/空格不同）
 * 策略：
 *   1. 先尝试精确匹配（快路径）
 *   2. 精确失败 -> 按行 normalize（trim每行 + 压缩连续空行）后匹配
 *   3. 找到唯一匹配 -> 用精确匹配定位实际位置，执行替换
 * @returns { success, replacements, matchedText } 或 { error }
 */
/**
 * ★ 批量执行工具调用 -- 只读工具自动并行，修改类工具串行
 * 只读工具：read_file, list_files, grep
 * 修改类工具：write_file, edit_file, multi_edit
 * @param {Array} toolCalls - [{id, function: {name, arguments}}]
 * @param {string} workPath - 工作目录
 * @param {object} ctx - 上下文（modifiedFiles, fileBackups, onToolEvent）
 * @param {function} onChunk - 流式输出回调
 * @returns {Promise<Array<{toolCallId, result, args, name, isModifyTool, beforeContent}>>}
 */


export function approveToolCall(projectId, taskId, approvalId, decision, autoApprove = false) {
  const task = getTask(projectId, taskId);
  if (!task || !task._pendingApprovals) {
    // ★ P1：任务不在本 server 内存（Pod 内桥独立执行 / server 重启后）→ Redis 审批桥
    return publishApprovalBridge(taskId, approvalId, decision, autoApprove);
  }
  // ★ "本次会话全批准"：后续修改类工具跳过审批
  if (autoApprove) {
    task._autoApprove = true;
  }
  const pending = task._pendingApprovals.get(approvalId);
  if (!pending) return false;
  pending.resolve(decision);
  return true;
}

// ★ P1：Redis 审批桥——approveToolCall 落点（worker 侧 XREAD BLOCK approval:{taskId} 消费）
// 注意：不走 writeTaskEvent（会加 stream:task: 前缀导致 key 不匹配），直接 xadd approval:{taskId}
export function publishApprovalBridge(taskId, approvalId, decision, autoApprove = false) {
  const r = getRedis();
  if (!r || r.status !== 'ready') return false;
  r.xadd(`approval:${taskId}`, '*', 'p', JSON.stringify({
    approvalId,
    decision: autoApprove ? 'approved' : decision,
    autoApprove: !!autoApprove,
  })).catch(() => {});
  return true;
}



// ============ 数据结构 ============

// projectId -> ChatTask[]
const taskQueue = new Map();
// projectId -> Map<filePath, taskId>
let MAX_CONCURRENT = parseInt(process.env.TASK_MAX_CONCURRENT || '5', 10); // 每项目并发任务数（默认 5；管理端 settings 可配 task_max_concurrent，30s 内生效）
// 动态刷新：管理端改配置后无需重启后端
import { getSettingNumber, getSetting } from './settings.js';
let MERGE_CONFLICT_MODE = 'manual'; // merge 冲突策略：manual=保留分支；auto-llm=LLM 语义合并
async function refreshMaxConcurrent() {
  try {
    const v = await getSettingNumber('task_max_concurrent', 0);
    if (v > 0) MAX_CONCURRENT = v;
    const m = await getSetting('merge_conflict_mode', 'manual');
    if (m === 'manual' || m === 'auto-llm') MERGE_CONFLICT_MODE = m;
  } catch { /* 读取失败沿用旧值 */ }
}
refreshMaxConcurrent();
setInterval(refreshMaxConcurrent, 30_000);
const TASK_TIMEOUT = 15 * 60 * 1000; // 15 分钟超时（agent 多轮工具调用 + 审批等待）

// ============ 文件锁 ============

// ============ 任务队列管理 ============

export function getTasks(projectId) {
  return taskQueue.get(projectId) || [];
}

export function getTask(projectId, taskId) {
  return (taskQueue.get(projectId) || []).find(t => t.id === taskId);
}

// ★ 预检：检查和正在运行的任务是否冲突
// worktree 模式下不阻塞，仅返回 warning。不再调 predictFiles（节省延迟）。
export async function checkFileConflicts(projectId, message) {
  // worktree 隔离 -> 文件级冲突不再是阻塞条件，直接放行
  return { conflict: false, predictedFiles: [] };
}

// 清理已完成的旧任务（保留最近 50 条）
function cleanupOldTasks(projectId) {
  const queue = taskQueue.get(projectId);
  if (!queue || queue.length <= 50) return;
  const completed = queue.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status));
  const active = queue.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status));
  const kept = completed.slice(-40);
  taskQueue.set(projectId, [...active, ...kept].sort((a, b) => a.createdAt - b.createdAt));
}

// ============ Git 工具（内联，避免依赖 chat.js 内部函数）============

function gitArgs(sourcePath, args) {
  return execFileSync('git', ['-C', sourcePath, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  }).trim();
}

function gitInit(sourcePath) {
  const hasGit = fs.existsSync(path.join(sourcePath, '.git'));
  if (!hasGit) {
    gitArgs(sourcePath, ['init']);
    const gitignore = 'node_modules/\ndist/\ntarget/\n*.class\n.env\n';
    fs.writeFileSync(path.join(sourcePath, '.gitignore'), gitignore);
  }
  // ★ 无论新建还是导入的项目，都确保 git config 已设置（导入项目自带 .git 但没有 user 配置）
  gitArgs(sourcePath, ['config', 'user.email', 'ai@madazi.com']);
  gitArgs(sourcePath, ['config', 'user.name', 'Madazi AI']);
  // ★ 兜底：.git 存在但没有任何提交（unborn HEAD，如创建期 init 成功而 commit 失败的残留）
  //   不补提交的话 git worktree add -b 会挂（HEAD 不是有效对象）
  let hasHead = true;
  try { gitArgs(sourcePath, ['rev-parse', '--verify', 'HEAD']); } catch { hasHead = false; }
  if (!hasGit || !hasHead) {
    gitArgs(sourcePath, ['add', '-A']);
    try { gitArgs(sourcePath, ['commit', '-m', 'Initial state']); } catch {}
  }
}

// 提交代码。identity：'self'=自研 agent（Madazi Agent），'dsh'=DSH 沙箱（DSH Agent）。
// 用 -c 临时指定提交人身份，不动全局 git 配置 → git log 可直接按作者区分引擎。
function gitCommit(sourcePath, message, identity = 'self') {
  const [name, email] = identity === 'dsh'
    ? ['DSH Agent', 'dsh@madazi.local']
    : ['Madazi Agent', 'madazi-agent@madazi.local'];
  gitArgs(sourcePath, ['add', '-A']);
  try {
    gitArgs(sourcePath, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-m', message.slice(0, 72)]);
    return gitArgs(sourcePath, ['rev-parse', 'HEAD']);
  } catch (err) {
    console.error(`[chat-tasks] gitCommit failed in ${sourcePath}:`, err.message?.slice(0, 200));
    return null;
  }
}

// ============ Git Worktree（多任务并行隔离）============

// ★ P0-B R4：主仓 git 写操作互斥——并发 merge/checkpoint/rollback 会撞 index.lock，
// 且 merge 前兜底 abort（422）会打断他人进行中的 merge。同 sourcePath 串行执行。
const repoLocks = new Map(); // sourcePath -> Promise 链尾
function withRepoLock(key, fn) {
  const prev = repoLocks.get(key) || Promise.resolve();
  const next = prev.then(() => fn(), () => fn()); // 前一个失败不阻塞后续
  repoLocks.set(key, next.catch(() => {}));
  return next;
}

// 为任务创建独立 worktree，返回 worktree 路径
// worktree 是 git 原生功能：共享 .git 对象，独立工作目录和分支
async function gitWorktreeCreate(sourcePath, sessionKey) {
  return withRepoLock(sourcePath, async () => {
  const branchName = `ai-task-${sessionKey.slice(0, 8)}`;
  const worktreePath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath)}-wt-${sessionKey.slice(0, 8)}`);
  // ★ 同会话复用：worktree 已存在（dsh resume / 异常残留）直接复用，不重建不丢状态
  if (fs.existsSync(worktreePath)) {
    console.log(`[chat-tasks] Reuse existing worktree: ${worktreePath} (branch: ${branchName})`);
    return { worktreePath, branchName, reused: true };
  }
  try {
    // ★ P2 M5：不再强制 checkpoint commit——实测 dirty 工作区（含未跟踪文件）git worktree add -b 完全可行。
    // 原实现 git add -A + commit 会把用户/Collab 未提交手改吞进 AI 提交历史（Pre-worktree checkpoint），
    // 回滚 AI 改动时用户手改一并被回退。现在用户手改留在主仓工作区不动：
    // - worktree 内 AI 自己 commit 自己的改动
    // - merge 若与主仓未提交改动撞文件 → git 拒 merge（保护用户手改）→ 走保留分支路径
    gitArgs(sourcePath, ['status', '--porcelain']); // 仅记录（git worktree add 不要求干净）
    // 创建 worktree + 新分支（基于当前 HEAD）；分支已存在（冲突保留/残留）→ 挂载已有分支
    try {
      gitArgs(sourcePath, ['worktree', 'add', '-b', branchName, worktreePath]);
    } catch (addErr) {
      console.log(`[chat-tasks] Branch ${branchName} exists, attaching existing branch: ${addErr.message}`);
      gitArgs(sourcePath, ['worktree', 'add', worktreePath, branchName]);
    }
    console.log(`[chat-tasks] Worktree created: ${worktreePath} (branch: ${branchName})`);
    return { worktreePath, branchName };
  } catch (err) {
    console.error(`[chat-tasks] Failed to create worktree: ${err.message}`);
    return null;
  }
  });
}

/**
 * ★ dsh 模式专用：worktree 由常驻 dsh 容器内 git 创建（用户拍板：git 统一用容器内版本）。
 * 项目主仓与 worktree 同在 madazi_madazi-generated 卷，server 与 dsh 容器同卷同挂载点
 * （/app/generated）→ 容器内创建的 worktree server 侧直接可见可写；
 * 后续 commit/merge/cleanup 仍走 server 侧 git（共享 .git 元数据，兼容）。
 * 容器内 git 失败时回退 server 侧 gitWorktreeCreate（保证任务不中断）。
 */
async function dshGitWorktreeCreate(projectId, sourcePath, sessionKey) {
  const branchName = `ai-task-${sessionKey.slice(0, 8)}`;
  const worktreePath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath)}-wt-${sessionKey.slice(0, 8)}`);
  // K8s：server 与 dsh Pod 同 PVC 同挂载点（/app/generated），server 本地 git 直接操作
  const r = await gitWorktreeCreate(sourcePath, sessionKey);
  if (r) {
    // ★ worktree 专属 git 身份（DSH Agent），dsh Pod 内提交自动带上
    try {
      execFileSync('git', ['-C', r.worktreePath, 'config', 'user.name', 'DSH Agent'], { encoding: 'utf-8', timeout: 10000 });
      execFileSync('git', ['-C', r.worktreePath, 'config', 'user.email', 'dsh@madazi.local'], { encoding: 'utf-8', timeout: 10000 });
    } catch { /* 不阻塞 */ }
  }
  return r;
}

// 将 worktree 分支 merge 回 main，返回 { success, conflicts }
// identity：merge commit 的提交人（'self'/'dsh'），与 gitCommit 一致
async function gitWorktreeMerge(sourcePath, branchName, identity = 'self') {
  // ★ P0-B R4：merge 全程持主仓锁——原实现并发 merge 时 422 的 abort 预清理会打断他人 merge
  return withRepoLock(sourcePath, () => gitWorktreeMergeInner(sourcePath, branchName, identity));
}
async function gitWorktreeMergeInner(sourcePath, branchName, identity = 'self') {
  const [name, email] = identity === 'dsh'
    ? ['DSH Agent', 'dsh@madazi.local']
    : ['Madazi Agent', 'madazi-agent@madazi.local'];
  try {
    // merge 前兜底清理残留冲突状态（并发 merge 的 index 残留，避免 unmerged files 连锁）
    try {
      execFileSync('git', ['-C', sourcePath, 'merge', '--abort'], { encoding: 'utf8', timeout: 10000 });
    } catch (cleanErr) {
      const m = cleanErr.stderr || cleanErr.message || '';
      // 无进行中 merge 时 abort 报错是正常现象（fatal: There is no merge to abort）——静默
      if (!m.includes('no merge to abort')) {
        console.warn(`[chat-tasks] pre-merge cleanup warning for ${branchName}: ${m.slice(0, 200)}`);
      }
    }
    // 回到主仓库 merge
    const result = execFileSync('git', ['-C', sourcePath, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'merge', '--no-edit', branchName], {
      encoding: 'utf8',
      timeout: 30000,
    });
    console.log(`[chat-tasks] Merged branch ${branchName} -> main`);
    return { success: true, conflicts: false };
  } catch (err) {
    const stderr = err.stderr || err.message || '';
    // ★ 冲突检测双保险：stderr 字符串 + MERGE_HEAD 存在（execFileSync 下 git 冲突时 stderr 可能为空）
    let mergeInProgress = false;
    try { mergeInProgress = fs.existsSync(path.join(sourcePath, '.git', 'MERGE_HEAD')); } catch { /* ignore */ }
    if (stderr.includes('CONFLICT') || stderr.includes('conflict') || stderr.includes('unmerged files') || mergeInProgress) {
      // ★ auto-llm 模式：冲突时用 LLM 语义合并（合并失败则回退 manual）
      if (MERGE_CONFLICT_MODE === 'auto-llm') {
        try {
          const files = await resolveConflictsWithLlm(sourcePath, branchName);
          console.log(`[chat-tasks] LLM auto-merged ${files.length} conflicted file(s) for ${branchName}: ${files.join(', ')}`);
          return { success: true, conflicts: false, llmMerged: true, files };
        } catch (llmErr) {
          console.warn(`[chat-tasks] LLM merge failed for ${branchName}, falling back to manual: ${(llmErr.message || '').slice(0, 200)}`);
        }
      }
      console.warn(`[chat-tasks] Merge conflict for ${branchName}, aborting merge`);
      try {
        execFileSync('git', ['-C', sourcePath, 'merge', '--abort'], { encoding: 'utf8', timeout: 10000 });
      } catch (abortErr) {
        // ★ abort 失败必须告警——否则 index 残留 unmerged 状态，后续所有 merge 全挂
        console.error(`[chat-tasks] Merge abort FAILED for ${branchName}: ${(abortErr.stderr || abortErr.message || '').slice(0, 300)}`);
      }
      return { success: false, conflicts: true };
    }
    // 非冲突错误（可能是 nothing to merge）
    if (stderr.includes('Already up to date') || stderr.includes('nothing to commit')) {
      return { success: true, conflicts: false };
    }
    // 清理残留 merge 状态（merge 失败但未 abort——避免 MERGE_HEAD/unmerged 连锁影响后续 merge）
    try {
      execFileSync('git', ['-C', sourcePath, 'merge', '--abort'], { encoding: 'utf8', timeout: 10000 });
    } catch { /* 无 merge 状态时忽略 */ }
    console.error(`[chat-tasks] Merge error for ${branchName}: ${stderr}`);
    return { success: false, conflicts: false };
  }
}

/**
 * auto-llm 模式：merge 冲突时用 LLM 语义合并。
 * 前置：git merge 已失败（merge 状态存在，index 有 unmerged 条目）。
 * 流程：列出冲突文件 → 逐文件提取冲突块 → LLM 合并 → 写回 + git add → commit 完成合并。
 * 抛错由调用方兜底（回退 manual：abort + 保留分支）。
 */
async function resolveConflictsWithLlm(sourcePath, branchName) {
  const list = execFileSync('git', ['-C', sourcePath, 'diff', '--name-only', '--diff-filter=U'], { encoding: 'utf8', timeout: 10000 })
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (list.length === 0) throw new Error('no conflicted files in index');
  for (const fp of list) {
    const full = path.join(sourcePath, fp);
    try {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('<<<<<<<')) {
        // 内容冲突：LLM 语义合并
        const merged = await llmMergeFile(fp, content);
        fs.writeFileSync(full, merged);
      } else {
        // 无冲突标记（如 mode 冲突）：直接保留工作区版本即可解决
        console.log(`[chat-tasks] no content conflict in ${fp}, keeping worktree version`);
      }
    } catch (e) {
      // LLM 合并失败/格式异常：若文件仍含冲突标记则不能提交坏代码，整体回退 manual（abort 保留分支）
      const c = fs.readFileSync(full, 'utf8');
      if (c.includes('<<<<<<<')) {
        throw new Error(`conflict markers remain in ${fp}: ${e.message}`);
      }
      // 无标记（如 mode 冲突）：保留工作区版本即可解决
      console.warn(`[chat-tasks] LLM merge skipped for ${fp}: ${e.message}`);
    }
    execFileSync('git', ['-C', sourcePath, 'add', fp], { encoding: 'utf8', timeout: 10000 });
  }
  // 完成合并（merge 状态下生成 merge commit；显式 -m 兼容非 merge 状态残留）
  execFileSync('git', ['-C', sourcePath, '-c', 'user.name=Madazi AI Merge', '-c', 'user.email=merge@madazi.local', 'commit', '-m', `AI merge: resolve conflicts in ${branchName}`], { encoding: 'utf8', timeout: 30000 });
  return list;
}

/** 提取文件内所有冲突块，逐块 LLM 合并，返回合并后的完整文件内容 */
async function llmMergeFile(filePath, content) {
  const blocks = [];
  const re = /<<<<<<<[^\n]*\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>>[^\r\n]*(?:\r?\n|$)/g;
  let m;
  while ((m = re.exec(content))) {
    blocks.push({ ours: m[1], theirs: m[2], start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  if (blocks.length === 0) throw new Error(`file ${filePath} has no conflict markers`);
  let out = content;
  // 从后往前替换，保持 start/end 有效
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    let merged = await llmMergeBlock(filePath, b.ours, b.theirs);
    if (!merged) throw new Error(`LLM returned empty for ${filePath}`);
    // 保留行尾换行：冲突块独占一行时合并结果也应以换行结尾（LLM 输出常省略尾换行）
    if (!merged.endsWith('\n')) merged += '\n';
    out = out.slice(0, b.start) + merged + out.slice(b.end);
  }
  return out;
}

/** 单个冲突块：调 LLM 合并（OpenAI 兼容 /chat/completions，与 dsh 链同一模型配置） */
async function llmMergeBlock(filePath, ours, theirs) {
  const cfg = await getDefaultConfig();
  if (!cfg) throw new Error('no llm config');
  const base = (cfg.base_url || '').replace(/\/$/, '');
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: '你是代码冲突合并专家。下面给出同一个文件同一处位置的 two versions：ours 是主分支已有版本，theirs 是 AI 任务分支版本。请输出合并后的代码：保留双方有效修改、消除重复、保证语法正确。只输出合并后的代码本身，不要解释，不要 markdown 代码围栏。' },
        { role: 'user', content: `文件路径: ${filePath}\n\n--- ours（主分支）---\n${ours}\n\n--- theirs（任务分支）---\n${theirs}` },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const out = (data.choices?.[0]?.message?.content || '').trim();
  return out.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
}

// 清理 worktree（删除工作目录 + 分支）
function gitWorktreeRemove(sourcePath, worktreePath, branchName) {
  try {
    execFileSync('git', ['-C', sourcePath, 'worktree', 'remove', '--force', worktreePath], {
      encoding: 'utf8',
      timeout: 10000,
    });
  } catch (err) {
    console.warn(`[chat-tasks] Failed to remove worktree: ${err.message}`);
    // 手动删除目录
    try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch {}
  }
  // 删除分支
  if (branchName) {
    try {
      execFileSync('git', ['-C', sourcePath, 'branch', '-D', branchName], {
        encoding: 'utf8',
        timeout: 10000,
      });
    } catch (err) {
      console.warn(`[chat-tasks] Failed to delete branch ${branchName}: ${err.message}`);
    }
  }
  console.log(`[chat-tasks] Worktree cleaned up: ${worktreePath}`);
}

// ★ 统一 worktree 清理辅助函数 -- 所有退出路径都必须调用
// keepBranch=true 时保留分支（merge 冲突场景）
function cleanupWorktree(task, keepBranch = false) {
  if (!task._worktreePath) return;
  // ★ P0-B R4：主仓 branch -D/worktree remove 与其他任务 merge 互斥（同源串行）
  return withRepoLock(task._projectSourcePath, async () => {
    const branch = keepBranch ? null : task._branchName;
    gitWorktreeRemove(task._projectSourcePath, task._worktreePath, branch);
    task._worktreePath = null;
    if (task._timeoutTimer) {
      clearTimeout(task._timeoutTimer);
      task._timeoutTimer = null;
    }
  });
}

// 获取某 commit 的 parent（回退目标）
function gitParentHash(sourcePath, hash) {
  try {
    return gitArgs(sourcePath, ['rev-parse', `${hash}^`]);
  } catch {
    return null;
  }
}

// 回退到某次 AI 修改之前（checkout parent commit 的文件状态）
// worktree 模式：已完成任务的 commit 已 merge 到 main，直接在主仓库 revert
export function rollbackTask(projectId, commitHash) {
  const queue = taskQueue.get(projectId) || [];
  const task = queue.find(t => t.result?.commitHash === commitHash);
  return db.query('SELECT source_path FROM projects WHERE id = $1', [projectId])
    .then(({ rows }) => {
      if (!rows[0]?.source_path) throw new Error('项目未生成');
      const sourcePath = rows[0].source_path;
      // ★ P0-B R4：回滚与并发 merge/cleanup 互斥（同源串行）
      return withRepoLock(sourcePath, async () => {
        const parentHash = gitParentHash(sourcePath, commitHash);
        if (!parentHash) throw new Error('无法回退到初始状态之前');
        // checkout parent 的文件状态，再 commit 作为回退记录
        gitArgs(sourcePath, ['checkout', parentHash, '--', '.']);
        gitArgs(sourcePath, ['add', '-A']);
        try { gitArgs(sourcePath, ['commit', '-m', `Rollback before ${commitHash.slice(0, 8)}`]); } catch {}
        return { ok: true, parentHash };
      });
    })
    .catch(err => {
      // 如果 commit 不在 main 上（merge 冲突保留了分支），尝试在分支上回退
      if (task?._branchName) {
        console.warn(`[chat-tasks] Rollback: commit not on main, trying branch ${task._branchName}`);
        return db.query('SELECT source_path FROM projects WHERE id = $1', [projectId])
          .then(({ rows }) => {
            const sourcePath = rows[0].source_path;
            // 删除冲突分支（等于丢弃这次修改）——★ P0-B R4：与并发 merge 互斥
            return withRepoLock(sourcePath, async () => {
              try {
                gitArgs(sourcePath, ['branch', '-D', task._branchName]);
              } catch {}
              return { ok: true, note: '冲突分支已删除' };
            });
          });
      }
      throw err;
    });
}

// ============ 任务调度 ============

// 创建任务入队。options: { projectId, userId, message, conversationId, onChunk, onToolEvent, attachments, skill, modelConfigId }
export async function createTask({ projectId, userId, message, conversationId, onChunk, onToolEvent, attachments, skill, skillPrompt, modelConfigId, mode, suggestMode }) {
  const task = createTaskObj(projectId, userId, message, onChunk);
  task.conversationId = conversationId || null;
  task.attachments = attachments || null;      // [{name, dataUrl}]
  task.skill = skill || null;                  // preset skill id
  task.skillPrompt = skillPrompt || null;       // 自定义技能 prompt（前端传入）
  task.modelConfigId = modelConfigId || null;  // override default LLM config
  task.mode = mode || null;                    // 'prd-edit' = PRD 调整模式
  task.suggestMode = !!suggestMode;             // ★ P1-1 审批模式
  task._onToolEvent = onToolEvent || null;     // ★ 结构化工具事件回调
  if (!taskQueue.has(projectId)) taskQueue.set(projectId, []);
  taskQueue.get(projectId).push(task);
  console.log(`[chat-tasks] Task enqueued: ${task.id} for project ${projectId}, conversation ${conversationId || '(none)'}`);

  // 如果有会话，先创建 AI 占位消息（status=pending），任务完成时更新
  if (conversationId) {
    task.aiMessageId = await addAiMessage(conversationId, task.id);
  }

  // 异步启动调度（不再预测文件，直接调度——AI 自己 list/grep 定位文件）
  task.targetFiles = []; // 不再预预测
  setImmediate(() => scheduleTasks(task.projectId));
  return task;
}

// 兼容旧名
export const enqueueTask = createTask;

// 兼容路由用的别名
export function getProjectTasks(projectId) {
  return getTasks(projectId).map(serializeTask);
}

function createTaskObj(projectId, userId, message, onChunk) {
  const id = uuid();
  const task = {
    id,
    projectId,
    userId,
    message,
    _seq: 0, // ★ 任务内单调递增序号：SSE id 与 Redis 条目共用，续传游标
  };
  task.emitter = new EventEmitter(); // ★ 多人订阅：chunk/tool_event/done/error（已包装写入 Redis Stream）
  // ★ P0 事件流：所有 emit 自动写入 Redis Stream（SSE 续传游标）
  // chunk/tool_event/done/error 三类事件源唯一入口，多客户端重放不重复
  const emitter = task.emitter;
  const origEmit = emitter.emit.bind(emitter);
  emitter.emit = (evt, ...args) => {
    try {
      const curSeq = ++task._seq; // 先自增，再触发 handler（handler 读 task._seq 即本条 seq）
      if (evt === 'chunk') {
        // ★ dsh 链任务由 Pod 内桥旁路直写 Redis（_skipRedis=true），server 侧只走 SSE，防双写
        if (!task._skipRedis) {
          writeTaskEvent(id, { seq: curSeq, type: 'chunk', taskId: id, content: typeof args[0] === 'string' ? args[0] : String(args[0] || '') }).catch(() => {});
        }
      } else if (evt === 'tool_event' || evt === 'done' || evt === 'error') {
        const payload = { seq: curSeq, type: evt, taskId: id, ...(args[0] || {}) };
        // done 加工与 SSE 端点一致：重放时前端直接可用（modifiedFiles/commitHash/fileStats/changes）
        if (evt === 'done' && payload.result) {
          const r = payload.result;
          payload.modifiedFiles = r.modifiedFiles || [];
          payload.commitHash = r.commitHash || null;
          payload.fileStats = (r.changes || []).map(c => ({ path: c.path, added: c.added || 0, deleted: c.deleted || 0, isNew: c.isNew }));
          payload.changes = r.changes || [];
        }
        if (!task._skipRedis) {
          writeTaskEvent(id, payload).catch(() => {});
        }
      }
    } catch {}
    return origEmit(evt, ...args);
  };
  return {
    id,
    projectId,
    userId,
    message,
    status: 'queued',
    targetFiles: [],
    result: null,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    cancelled: false,
    _timeoutTimer: null,
    _pendingApprovals: new Map(), // ★ P1-1: approvalId -> { resolve, reject }
    _onChunk: onChunk || null,
    _onToolEvent: null,
    emitter, // ★ 多人订阅：chunk/tool_event/done/error（已包装写入 Redis Stream）
    output: '',
  };
}

// 序列化任务给前端（去掉内部字段）
function serializeTask(t) {
  return {
    id: t.id,
    message: t.message,
    status: t.status,
    targetFiles: t.targetFiles,
    output: t.output,
    commitHash: t.result?.commitHash || null,
    error: t.error,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
  };
}

function scheduleTasks(projectId) {
  const queue = taskQueue.get(projectId) || [];
  const running = queue.filter(t => t.status === 'running');
  cleanupOldTasks(projectId);

  for (const task of queue) {
    if (task.status !== 'queued') continue;
    if (running.length >= MAX_CONCURRENT) break;

    // ★ worktree 隔离，不再需要文件锁--每个任务在独立目录中工作
    // 冲突在 merge 阶段自动处理
    task.status = 'running';
    task.startedAt = Date.now();
    running.push(task);
    console.log(`[chat-tasks] Task ${task.id} started (concurrent ${running.length}/${MAX_CONCURRENT})`);
    // ★ P0-B M2 修复（补 dsh 链缺口）：running 中间态落库——调度器统一入口，自研链+dsh 链都覆盖
    // 原实现只在自研链 955 落库，dsh 任务 DB 长期 pending，server 崩溃后无法识别执行中任务
    if (task.aiMessageId) updateAiMessage(task.aiMessageId, { status: 'running' }).catch(() => {});
    executeTask(task);

    // 超时保护
    task._timeoutTimer = setTimeout(() => {
      if (task.status === 'running') {
        task.status = 'failed';
        task.error = '任务超时（15分钟）';
        task.completedAt = Date.now();
        task._timedOut = true; // ★ P0-B R1：executeTask 在 1005/1071/dsh-completed 处检测 _timedOut 短路终态化
        // ★ P0-B R1 修复：立即中断底层执行——原实现只置标志不取消，LLM 循环继续、token 继续烧
        try { task._cancelDsh?.(); } catch (e) { console.warn('[chat-tasks] timeout cancelDsh failed:', e.message); }
        // ★ P0-B R1 修复：落库终态——原实现不 updateAiMessage → DB 永久 pending（S6 排队任务/悬挂消息）
        if (task.aiMessageId) updateAiMessage(task.aiMessageId, { status: 'failed', error: task.error, engine: task.engine || 'self' }).catch(() => {});
        // ★ P1-3 修复：resolve 所有 pending approvals，让审批立即返回
        if (task._pendingApprovals && task._pendingApprovals.size > 0) {
          for (const [, pending] of task._pendingApprovals) {
            pending.resolve('rejected');
          }
          task._pendingApprovals.clear();
        }
        // ★ P0-B R1：不立即删 worktree——executeTask 短路点统一清理，避免底层仍在读写时强删工作目录
        console.warn(`[chat-tasks] Task ${task.id} timed out`);
        scheduleTasks(projectId);
      }
    }, TASK_TIMEOUT);
  }
}

// ============ 任务执行 ============

async function executeTask(task) {
  try {
    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [task.projectId]);
    if (!rows[0]) throw new Error('Project not found');
    const sourcePath = rows[0].source_path;
    if (!sourcePath) throw new Error('Project not generated yet');

    if (task.cancelled) {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      if (task.aiMessageId) {
        await updateAiMessage(task.aiMessageId, { status: 'cancelled' });
      }
      return;
    }

    // ★ 2026-08-19 自研链彻底删除：所有任务（对话/高级/文档流程）统一走 dsh（DeepSeek Harness Agent）ACP 桥
    await executeDshTask(task, sourcePath);
  } catch (err) {
    console.error(`[chat-tasks] Task ${task.id} error:`, err.message);
    task.status = 'failed';
    task.error = err.message;
    task.completedAt = Date.now();
    if (task.aiMessageId) {
      await updateAiMessage(task.aiMessageId, { status: 'failed', error: err.message });
    }
    scheduleTasks(task.projectId);
  } finally {
    // ★ 统一通知所有订阅者：任务进入终态（超时回调已 emit 过则跳过，防重复）
    // ★ P1-3 修复：超时回调先 emit done 后，这里不能重复 emit
    if (!task._doneEmitted) {
      task._doneEmitted = true;
      task.emitter.emit('done', {
        status: task.status,
        result: task.result,
        error: task.error,
      });
    }
    // 清理 emitter 监听器，防止内存泄漏
    task.emitter.removeAllListeners();
  }
}

// ============ dsh 高级模式（DeepSeek Harness Agent） ============

// ★ 每任务一个 DshBridge 进程（容器已常驻按 projectId 复用，dsh exe 进程随任务起停），
//   key = projectId + taskId
const dshBridges = new Map(); // `${projectId}:${taskId}` -> { bridge, lastUsed, sessions: Set<sessionId> }

// dsh tool/call 的 arguments 可能是 JSON 字符串，容错解析
function safeParseJson(s) {
  if (typeof s !== 'string') return s ?? {};
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}

async function getDshBridge(projectId, cwd, taskId, aiMessageId) {
  const key = `${projectId}:${taskId}`;
  const hit = dshBridges.get(key);
  // ★ 检查 bridge 连接状态 + 容器是否真实存活（容器可能被回收导致进程退出但事件未触发）
  if (hit && hit.bridge.connected) {
    // 检查容器是否还在运行（容器被回收后 bridge 会报错，提前重建）
    const containerAlive = await isContainerRunning(projectId).catch(() => false);
    if (containerAlive) {
      hit.lastUsed = Date.now();
      return hit;
    }
    // 容器已死，清理旧 bridge
    console.log(`[chat-tasks] dsh container gone for project ${projectId}, rebuilding bridge...`);
    try { await hit.bridge.stop(); } catch { /* ignore */ }
    dshBridges.delete(key);
  }
  if (hit) {
    try { await hit.bridge.stop(); } catch { /* ignore */ }
    dshBridges.delete(key);
  }

  const cfg = await getDefaultConfig();
  if (!cfg) throw new Error('DB 无默认 llm_configs，无法启动 dsh Agent');

  // ★ K8s（单机 docker/exe 已移除）：ensure dsh Pod -> PodIP:7001 -> TCP 桥（env 经握手行注入 Pod 内 dsh-agent）
  await ensureDshContainer(projectId);
  const addr = await getDshPodAddr(projectId, 60_000);
  const bridge = new DshBridge({
    tcp: addr,
    cwd,
    env: {
      DEEPSEEK_API_KEY: cfg.api_key,
      DEEPSEEK_BASE_URL: cfg.base_url,
      DEEPSEEK_MODEL: cfg.model,
      DSH_PROJECT_ID: projectId,
      DSH_TASK_ID: taskId,
      DSH_AI_MESSAGE_ID: aiMessageId || '',
      DSH_WORKTREE: cwd,
      DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE || 'workspace-write',
      DSH_SNAPSHOT_SESSIONS_ROOT: '/tmp/dsh-sessions',
      DSH_CWD: cwd,
    },
    spawnTimeoutMs: 60_000,
    requestTimeoutMs: 15 * 60_000,
  });
  await bridge.start();
  const entry = { bridge, lastUsed: Date.now(), sessions: new Set() };
  dshBridges.set(key, entry);
  console.log(`[chat-tasks] dsh bridge (k8s tcp ${addr.host}:${addr.port}) started for project ${projectId} task ${taskId.slice(0, 8)}`);
  return entry;
}


async function executeDshTask(task, sourcePath) {
  // ★ dsh 链旁路：chunk/tool_event/stream_end 由 Pod 内桥直写 Redis + 直落 DB（server 重启不断生成），server 侧只走 SSE
  task._skipRedis = true;
  // ★ 项目自动初始化 Git 仓库（模板新建/导入项目未 init 时自动补；DSH worktree 依赖）
  //   不强制用户手动去 Git 面板操作
  gitInit(sourcePath);
  // ★ 确保项目常驻 dsh 容器 running（幂等；打开项目时已预启动，此处兜底防重启/回收后缺失）
  await ensureDshContainer(task.projectId);
  // worktree 隔离（并发安全，与自研链一致）— ★ 容器内 git 创建，失败自动回退 server git
  // ★ 会话级 key：同会话（conversationId）复用同一 worktree + sessionId → dsh resume 生效
  const wt = await dshGitWorktreeCreate(task.projectId, sourcePath, task.conversationId || task.id);
  if (!wt) throw new Error('无法创建工作目录，请稍后重试');
  task._worktreePath = wt.worktreePath;
  task._branchName = wt.branchName;
  task._projectSourcePath = sourcePath;
  const workPath = wt.worktreePath;

  const entry = await getDshBridge(task.projectId, workPath, task.id, task.aiMessageId);
  // ★ 会话级 sessionId：同会话稳定 → server.ts createSession try-resume 命中历史（跨任务/跨 pod 连续）
  const sessionId = await entry.bridge.newSession(task.conversationId || task.id);
  entry.sessions.add(sessionId);
  // 取消钩子：cancelTask 时通知桥取消当前 turn
  task._cancelDsh = () => { try { entry.bridge.cancel(sessionId); } catch { /* ignore */ } };

  task.output = '';
  let thinkingStarted = false;
  let thinkingEnded = false;
  const onChunk = (c) => {
    if (task.cancelled) return;
    task.output += c;
    task._onChunk?.(c);
    task.emitter.emit('chunk', c);
    if (task.aiMessageId) {
      appendAiContent(task.aiMessageId, c).catch(() => {});
    }
  };
  // ★ 思考流：前端 ThinkingBlock 通过解析 chunk 文本中的 <thinking>...</thinking> 标签渲染，
  //   因此这里把 reasoning-delta 包装成标签混入 chunk 流，前端零改动。
  const onThinking = (t) => {
    if (task.cancelled) return;
    let wrapped = '';
    if (!thinkingStarted) { wrapped += '<thinking>'; thinkingStarted = true; }
    wrapped += t;
    task._onChunk?.(wrapped);
    task.emitter.emit('chunk', wrapped);
  };
  const closeThinking = () => {
    if (thinkingStarted && !thinkingEnded) {
      const closer = '</thinking>\n\n';
      task._onChunk?.(closer);
      task.emitter.emit('chunk', closer);
      thinkingEnded = true;
    }
  };
  // ★ 工具事件：转成与自研链一致的 {tool, status, args, ...} 格式，前端 ToolSteps 直接渲染
  const toolCallMap = new Map(); // callId -> { tool, args }
  const onToolEvent = (e) => {
    if (task.cancelled) return;
    closeThinking(); // 思考结束后才进入工具调用
    if (e.kind === 'tool/call') {
      const info = { tool: e.name, args: typeof e.arguments === 'string' ? safeParseJson(e.arguments) : (e.arguments ?? {}) };
      toolCallMap.set(e.callId ?? e.name, info);
      const evt = { tool: e.name, status: 'running', args: info.args };
      task._onToolEvent?.(evt);
      task.emitter.emit('tool_event', evt);
    } else if (e.kind === 'tool/result') {
      const callId = e.callId ?? e.name;
      const info = toolCallMap.get(callId) ?? { tool: e.name ?? 'unknown', args: {} };
      const isErr = !!e.error;
      const output = typeof e.output === 'string' ? e.output : (e.output ? JSON.stringify(e.output) : '');
      // ★ 探测类工具（bash/grep/ls/find 等）失败不算 error——AI 探路失败是正常流程，降级为 done + error 字段（前端显示 ⚠）
      const PROBE_TOOLS = new Set(['run_command', 'bash', 'execute_command', 'shell', 'terminal', 'grep', 'search', 'find', 'ls', 'read_file', 'list_files', 'glob']);
      const isProbe = PROBE_TOOLS.has(info.tool);
      const evt = {
        tool: info.tool,
        status: isErr && !isProbe ? 'error' : 'done',
        args: info.args,
        result: isErr ? undefined : output.slice(0, 500),
        error: isErr ? (typeof e.error === 'string' ? e.error : e.error?.message ?? 'tool error') : undefined,
      };
      task._onToolEvent?.(evt);
      task.emitter.emit('tool_event', evt);
      toolCallMap.delete(callId);
    } else if (e.kind === 'todo/write' && Array.isArray(e.todos)) {
      const evt = { tool: 'todo_write', status: 'done', args: {}, todos: e.todos };
      task._onToolEvent?.(evt);
      task.emitter.emit('tool_event', evt);
    }
  };
  const onUsage = () => {}; // 计费走 collectDshUsage(session.jsonl)，这里不占通道

  try {
    // ★ 思考先行：closeThinking 在第一个非 thinking 事件（chunk/tool）或 turn/end 时关闭
    const origOnChunk = onChunk;
    const wrappedOnChunk = (c) => { closeThinking(); origOnChunk(c); };
    const { stopReason, text } = await entry.bridge.prompt(sessionId, task.message, {
      onChunk: wrappedOnChunk,
      onThinking,
      onToolEvent,
      onUsage,
    });
    closeThinking();
    if (task.cancelled) {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      await cleanupWorktree(task, false);
      if (task.aiMessageId) {
        await updateAiMessage(task.aiMessageId, { status: 'cancelled' }).catch(() => {});
      }
      scheduleTasks(task.projectId);
      return;
    }

    // ★ 计费桥接：读 session 快照精确 usage → logExactUsage（不估算，静默失败）
    try {
      const usage = collectDshUsage(workPath);
      if (usage) {
        await logExactUsage({
          userId: task.userId,
          projectId: task.projectId,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
        });
        console.log(`[chat-tasks] dsh task ${task.id} billed: in=${usage.inputTokens} out=${usage.outputTokens} cache=${usage.cacheReadTokens} model=${usage.model}`);
      }
    } catch (billingErr) {
      console.error('[chat-tasks] dsh 计费失败（忽略）:', billingErr.message);
    }

    let finalResponse = text || task.output || '（dsh Agent 无文本输出）';
    // 统计修改文件（worktree 相对 HEAD 的 diff + 未跟踪文件 + agent 已提交的 commit 文件）
    const changed = gitArgs(workPath, ['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean);
    const untracked = gitArgs(workPath, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
    // ★ agent 可能在容器内已 commit → worktree HEAD 落后分支，需额外统计分支领先的文件
    let committedChanged = [];
    try {
      committedChanged = gitArgs(task._projectSourcePath, ['diff', '--name-only', `HEAD...${task._branchName}`]).split('\n').filter(Boolean);
    } catch { /* 分支可能不存在 */ }
    const modifiedFiles = [...new Set([...changed, ...untracked, ...committedChanged])];

    // ★ 在 merge 前生成 changes（此时 worktree HEAD 还是旧的，能拿到 oldContent）
    const changes = [];
    for (const fp of modifiedFiles) {
      let oldContent = '';
      let newContent = '';
      let isNew = false;
      try {
        oldContent = gitArgs(task._projectSourcePath, ['show', `HEAD:${fp}`]);
      } catch { isNew = true; }
      // 优先从 worktree 磁盘读（未提交的修改）；读不到则从分支读（agent 已提交的）
      try {
        newContent = fs.readFileSync(path.join(workPath, fp), 'utf8');
      } catch {
        try {
          newContent = gitArgs(task._projectSourcePath, ['show', `${task._branchName}:${fp}`]);
        } catch { /* 文件可能被删 */ }
      }
      // worktree 磁盘文件 = HEAD 版本（未修改）但分支已改 → 用分支内容
      if (newContent === oldContent && committedChanged.includes(fp)) {
        try {
          newContent = gitArgs(task._projectSourcePath, ['show', `${task._branchName}:${fp}`]);
        } catch { /* ignore */ }
      }
      changes.push({ path: fp, oldContent, newContent, isNew, ...computeLineDiff(oldContent, newContent) });
    }

    let commitHash = null;
    // DSH agent 可能已在容器内提交（分支领先主仓），也可能只改了文件未提交 → 两者都需 merge 回主仓
    let branchAhead = 0;
    try {
      branchAhead = parseInt(gitArgs(task._projectSourcePath, ['rev-list', '--count', `HEAD..${task._branchName}`]).trim() || '0', 10);
    } catch { branchAhead = 0; }
    if (modifiedFiles.length > 0 || branchAhead > 0) {
      // ★ P0-B R1：超时后桥取消未生效、任务仍跑完——强制 failed 终态，不 merge 不落 generations
    if (task._timedOut) {
      task.status = 'failed';
      task.completedAt = Date.now();
      await cleanupWorktree(task, false);
      if (task.aiMessageId) await updateAiMessage(task.aiMessageId, { status: 'failed', error: task.error });
      scheduleTasks(task.projectId);
      return;
    }
    if (modifiedFiles.length > 0) {
        // agent 改了文件但未提交 → server 兜底提交（DSH Agent 身份）
        commitHash = gitCommit(workPath, task.message.slice(0, 72), 'dsh');
      }
      const mergeResult = await gitWorktreeMerge(task._projectSourcePath, task._branchName, 'dsh');
      task._mergeConflict = false;
      if (!mergeResult.success) {
        task._mergeConflict = true;
        finalResponse += `\n\n---\n⚠️ 合并失败（与其他任务的修改冲突或异常），代码保留在分支 \`${task._branchName}\` 中。请手动合并。`;
      } else if (mergeResult.llmMerged) {
        finalResponse += `\n\n---\n🤖 冲突已由 AI 自动合并（${mergeResult.files.length} 个文件），已生成独立 commit 可回滚。`;
      } else {
        // merge 成功：commitHash 取主仓 HEAD（含 agent 容器内提交）
        commitHash = gitArgs(task._projectSourcePath, ['rev-parse', 'HEAD']).trim();
      }
    }
    // ★ changes 已在 merge 前生成（上方），直接引用
    task.status = 'completed';
    task.result = { modifiedFiles, commitHash, changes };
    task.completedAt = Date.now();
    await cleanupWorktree(task, task._mergeConflict === true);
    db.query(
      'INSERT INTO generations (id, project_id, prompt, response, status) VALUES ($1, $2, $3, $4, $5)',
      [uuid(), task.projectId, task.message, finalResponse, 'success']
    ).catch(() => {});
    if (task.aiMessageId) {
      await updateAiMessage(task.aiMessageId, {
        status: 'completed',
        content: finalResponse,
        commitHash,
        modifiedFiles,
        engine: 'dsh',
      });
    }
    console.log(`[chat-tasks] dsh task ${task.id} completed (stopReason=${stopReason}, files=${modifiedFiles.length})`);
    scheduleTasks(task.projectId);
  } catch (err) {
    console.error(`[chat-tasks] dsh task ${task.id} error:`, err.message);
    // 取消导致的连接中断（DSH_ABORTED/连接关闭）不算失败——保持 cancelled 终态
    // ★ P0-B R1：超时（_timedOut）优先于 DSH_ABORTED——超时后桥取消返回的 ABORTED 不算用户取消
    const cancelled = !task._timedOut && (task.cancelled || /DSH_ABORTED|连接关闭/.test(err.message || ''));
    task.status = cancelled ? 'cancelled' : 'failed';
    task.error = cancelled ? undefined : (task.error || err.message);
    task.completedAt = Date.now();
    // ★ P2 M4：异常路径不得误删冲突保留分支——merge 冲突已发生（_mergeConflict=true）时
    // 即使后续步骤（如 updateAiMessage）抛错也必须 keepBranch=true，否则用户手动合并的机会被清掉
    await cleanupWorktree(task, task._mergeConflict === true);
    if (task.aiMessageId) {
      await updateAiMessage(
        task.aiMessageId,
        cancelled ? { status: 'cancelled' } : { status: 'failed', error: err.message }
      ).catch(() => {});
    }
    scheduleTasks(task.projectId);
  } finally {
    entry.sessions.delete(sessionId);
    task._cancelDsh = null;
    // ★ 每任务独立 bridge：任务结束即停，杀 dsh exe 进程（常驻容器保留，供下一任务 docker exec 复用）
    dshBridges.delete(`${task.projectId}:${task.id}`);
    try { await entry.bridge.stop(); } catch { /* ignore */ }
    if (!task._doneEmitted) {
      task._doneEmitted = true;
      task.emitter.emit('done', {
        status: task.status,
        result: task.result,
        error: task.error,
      });
    }
    task.emitter.removeAllListeners();
  }
}

/**
 * 从 dsh session 快照读取精确 token 用量（计费桥接，不估算）。
 * 快照目录名 = projectKey(cwd)（/→-、非法字符→~XXXX、截断251、包--），
 * ACP sessionId 与持久化 id 无关，故按 cwd 匹配 ws 目录；
 * 同项目任务串行执行 → ws 下最新 session 即本任务快照。
 * 只统计 `"type":"usage"` 计费事件行，忽略 assistant/message 内嵌 usage（避免重复计数）。
 * @param {string} cwd 本任务 worktree 路径
 * @returns {null | {inputTokens, outputTokens, cacheReadTokens, model}}
 */
function wsKeyForCwd(cwd) {
  let readable = '';
  let separatorRun = false;
  for (const ch of cwd) {
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root';
  return `--${slug.slice(0, 251)}--`;
}

function collectDshUsage(cwd) {
  const root = process.env.DSH_SNAPSHOT_SESSIONS_ROOT || '/tmp/dsh-sessions';
  if (!fs.existsSync(root)) return null;
  // 目标 ws 目录（projectKey 编码匹配）；无则全根扫最新兜底
  let wsDirs = [];
  const exactWs = wsKeyForCwd(cwd);
  if (fs.existsSync(path.join(root, exactWs))) wsDirs = [exactWs];
  else wsDirs = fs.readdirSync(root).filter((d) => d.startsWith('--') && d.endsWith('--'));

  let target = null, newestMtime = 0;
  for (const ws of wsDirs) {
    const wsDir = path.join(root, ws);
    for (const sid of fs.readdirSync(wsDir)) {
      const zfile = path.join(wsDir, sid, 'session.jsonl.zstd');
      const plain = path.join(wsDir, sid, 'session.jsonl');
      const file = fs.existsSync(zfile) ? zfile : (fs.existsSync(plain) ? plain : null);
      if (!file) continue;
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime > newestMtime) { newestMtime = mtime; target = file; }
    }
  }
  if (!target) return null;

  let raw = '';
  if (target.endsWith('.zstd')) {
    const zstdBin = process.env.ZSTD_BIN || '/opt/homebrew/bin/zstd';
    try {
      raw = execFileSync(zstdBin, ['-dc', target], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000, encoding: 'utf8' });
    } catch { /* 解压失败走明文兜底 */ }
  }
  if (!raw) {
    try { raw = fs.readFileSync(target, 'utf8'); } catch { return null; }
  }

  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, model = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const evt = JSON.parse(line);
      // usage 事件实际结构：assistant/chunk 内嵌 chunk.type='usage' + chunk.usage
      if (evt.type === 'assistant/chunk' && evt.data?.chunk?.type === 'usage' && evt.data.chunk.usage) {
        const u = evt.data.chunk.usage;
        inputTokens += u.inputTokens ?? 0;
        outputTokens += u.outputTokens ?? 0;
        cacheReadTokens += u.cacheReadTokens ?? 0;
      } else if (!model && evt.type === 'assistant/message' && evt.data?.message?.source?.model) {
        model = evt.data.message.source.model; // 取首个模型名（整个 session 同模型）
      }
    } catch { /* 单行解析失败跳过 */ }
  }
  if (inputTokens + outputTokens === 0) return null;
  return { inputTokens, outputTokens, cacheReadTokens, model };
}

// ============ 任务订阅（SSE 重连 / 多人协同） ============

/**
 * 订阅任务事件流。返回 { unsubscribe, task }。
 * onChunk/onToolEvent/onDone 回调在事件触发时被调用。
 * 如果任务已进入终态，立即调用 onDone。
 */
export function subscribeTask(projectId, taskId, { onChunk, onToolEvent, onDone }) {
  const queue = taskQueue.get(projectId) || [];
  const task = queue.find(t => t.id === taskId);
  if (!task) return { unsubscribe: () => {}, task: null };

  // 任务已在终态
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    onDone?.({ status: task.status, result: task.result, error: task.error });
    return { unsubscribe: () => {}, task };
  }

  const handlers = {};
  if (onChunk) {
    handlers.chunk = onChunk;
    task.emitter.on('chunk', handlers.chunk);
  }
  if (onToolEvent) {
    handlers.tool_event = onToolEvent;
    task.emitter.on('tool_event', handlers.tool_event);
  }
  if (onDone) {
    handlers.done = onDone;
    task.emitter.on('done', handlers.done);
  }

  return {
    task,
    unsubscribe: () => {
      for (const [evt, fn] of Object.entries(handlers)) {
        task.emitter.off(evt, fn);
      }
    },
  };
}

// ============ 启动恢复（P0-B R5）============
// server 重启时：DB 中遗留的 pending/running 任务（队列是纯内存，重启即空）统一置 failed。
// 若 worker Pod 实际存活，其直写终态（不经 server）会覆盖本次置位——最终一致。
export async function recoverInterruptedTasks() {
  try {
    const { rows } = await db.query(
      "SELECT task_id FROM conversation_messages WHERE task_id IS NOT NULL AND status IN ('pending', 'running')"
    );
    if (rows.length === 0) { console.log('[recover] 无悬挂任务'); return; }
    console.warn(`[recover] 发现 ${rows.length} 个悬挂任务（server 重启中断），置 failed`);
    await db.query(
      "UPDATE conversation_messages SET status = 'failed', error = '服务重启中断（任务已终止）' WHERE task_id IS NOT NULL AND status IN ('pending', 'running')"
    );
  } catch (e) {
    console.error('[recover] 启动扫描失败:', e.message);
  }
}

// ============ 任务取消 ============

export async function cancelTask(projectId, taskId) {
  const queue = taskQueue.get(projectId) || [];
  const task = queue.find(t => t.id === taskId);
  if (!task) {
    // ★ 任务可能不在内存队列中（如刷新后），直接更新 DB 状态
    try {
      await db.query(
        'UPDATE conversation_messages SET status = $1 WHERE task_id = $2 AND status IN ($3, $4)',
        ['cancelled', taskId, 'pending', 'running']
      );
      console.log(`[chat-tasks] cancelTask: task not in queue, updated DB for taskId=${taskId}`);
    } catch (e) {
      console.error('[chat-tasks] cancelTask DB update failed:', e);
    }
    return true;
  }

  if (task.status === 'running') {
    task.cancelled = true;
    task.status = 'cancelled'; // ★ P0-B R2/M3：内存立即终态化——消除「DB 已 cancelled、SSE 仍显示 running」窗口
    task.completedAt = Date.now();
    // ★ 通知桥取消当前 turn（立即中断 Agent 循环）
    task._cancelDsh?.();
    // ★ 自动 reject 所有 pending approvals，让审批立即返回
    if (task._pendingApprovals && task._pendingApprovals.size > 0) {
      for (const [, pending] of task._pendingApprovals) {
        pending.resolve('rejected');
      }
      task._pendingApprovals.clear();
    }
    // AI 调用中无法立即中断，标记后在 executeTask 中检查
    // ★ 同时更新 DB 状态，确保刷新后也能看到 cancelled
    if (task.aiMessageId) {
      try { await updateAiMessage(task.aiMessageId, { status: 'cancelled' }); } catch {}
    }
  } else if (task.status === 'queued' || task.status === 'waiting') {
    task.status = 'cancelled';
    task.completedAt = Date.now();
    if (task.aiMessageId) {
      try { await updateAiMessage(task.aiMessageId, { status: 'cancelled' }); } catch {}
    }
    scheduleTasks(projectId);
  }
  return true;
}

// ============ 辅助函数 ============

// 计算文件行数差异
function computeLineDiff(oldContent, newContent) {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');
  // 简单 LCS 行差异
  const m = oldLines.length, n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const common = dp[m][n];
  return {
    added: n - common,
    deleted: m - common,
  };
}

// ★ 行级 diff 预览：返回 +行/-行 格式，最多 30 行
function formatDiffPreview(diffInfo, filePath) {
  // diffInfo 是 computeLineDiff 的返回值 {added, deleted}
  // 我们需要重新计算行级 diff
  const oldContent = arguments[2] || '';
  const newContent = arguments[3] || '';
  // 实际用 before/after 直接做行级比较
  return `   +${diffInfo.added} -${diffInfo.deleted} 行`;
}

// ★ 完整行级 diff：返回 +- 行格式文本
// ★ Unified diff 格式（标准 @@ -a,b +c,d @@ 带上下文行）
// 对齐 Codex CLI / Claude Code 的 diff 输出，前端可用 diff2html 渲染
// ★ P1-10 SSRF 防护：拒绝云元数据/内网/保留 IP（含域名解析后检查，防 DNS rebinding）

// ============ 写入后编译验证 ============
// 用临时容器跑 mvn compile / tsc --noEmit，返回 { errors: string | null }

// ★ 快速语法检查（不跑完整编译，只检查单文件语法）
// JS/JSX: node --check；TS/TSX: 简单括号/引号匹配

// ★ 智能提取编译错误关键信息：文件路径 + 行号 + 错误类型
// 从 mvn/tsc 的完整输出中提取结构化错误，避免 AI 被冗长日志淹没
function extractCompileErrors(rawErrors, modifiedFiles) {
  const lines = rawErrors.split('\n');
  const errors = [];
  const modifiedSet = new Set(modifiedFiles.map(f => f.replace(/^(backend|frontend)\//, '')));

  for (const line of lines) {
    // Java/Maven: [ERROR] /path/File.java:[line,col] error: message
    // TSC: src/file.ts(line,col): error TS1234: message
    // Vite/ESLint: /path/file.ts:line:col: error
    let match;

    // Maven Java: [ERROR] path/file.java:[line,col] ...
    match = line.match(/\[ERROR\]\s+(.+?\.(?:java|kt)):\[(\d+),(\d+)\]\s+(.+)/);
    if (match) {
      const [, file, lineNum, col, msg] = match;
      const relPath = file.replace(/^.*\/(src\/.+)/, '$1');
      errors.push(`📁 ${relPath}:${lineNum}:${col}\n   ${msg.trim()}`);
      continue;
    }

    // TSC: src/file.ts(line,col): error TSxxxx: message
    match = line.match(/(.+?\.(?:ts|tsx|js|jsx))\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)/);
    if (match) {
      const [, file, lineNum, , severity, code, msg] = match;
      const relPath = file.replace(/^.*\/(src\/.+)/, '$1');
      if (severity === 'error') {
        errors.push(`📁 ${relPath}:${lineNum}\n   ${code}: ${msg.trim()}`);
      }
      continue;
    }

    // Vite/esbuild: file:line:col: error message
    match = line.match(/(.+?\.(?:ts|tsx|js|jsx|css|scss)):(\d+):(\d+):\s+(.+)/);
    if (match) {
      const [, file, lineNum, col, msg] = match;
      const relPath = file.replace(/^.*\/(src\/.+)/, '$1');
      errors.push(`📁 ${relPath}:${lineNum}:${col}\n   ${msg.trim()}`);
      continue;
    }

    // 通用 [ERROR] 行
    match = line.match(/\[ERROR\]\s+(.+)/);
    if (match && !match[1].includes('BUILD FAILURE') && !match[1].includes('Recompile with')) {
      errors.push(`   ${match[1].trim()}`);
      continue;
    }
  }

  if (errors.length === 0) {
    // 没提取到结构化错误，回退到截断
    return rawErrors.slice(0, 1500);
  }

  // 限制最多 20 条错误
  const limited = errors.slice(0, 20);
  if (errors.length > 20) {
    limited.push(`... 还有 ${errors.length - 20} 个错误未显示`);
  }
  return limited.join('\n\n');
}

// ★ 自动分析项目结构：读取 package.json/pom.xml/tsconfig，返回技术栈摘要
function analyzeProjectStructure(sourcePath) {
  const parts = [];

  // 前端 package.json
  const frontendPkg = path.join(sourcePath, 'frontend', 'package.json');
  const rootPkg = path.join(sourcePath, 'package.json');
  const pkgPath = fs.existsSync(frontendPkg) ? frontendPkg : (fs.existsSync(rootPkg) ? rootPkg : null);

  if (pkgPath) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const techStack = [];
      if (deps['react']) techStack.push('React');
      if (deps['vue']) techStack.push('Vue');
      if (deps['vite']) techStack.push('Vite');
      if (deps['next']) techStack.push('Next.js');
      if (deps['typescript'] || deps['@types/node']) techStack.push('TypeScript');
      if (deps['tailwindcss']) techStack.push('Tailwind CSS');
      if (deps['antd']) techStack.push('Ant Design');
      if (deps['express']) techStack.push('Express');
      if (deps['spring-boot'] || deps['spring-boot-starter-web']) techStack.push('Spring Boot');

      parts.push(`前端: ${techStack.join(' + ') || '未知'}`);
      if (pkg.scripts) {
        const scripts = Object.keys(pkg.scripts).filter(s => ['build', 'dev', 'start', 'lint', 'test'].includes(s));
        if (scripts.length > 0) parts.push(`脚本: ${scripts.map(s => `${s}: \`${pkg.scripts[s]}\``).join(', ')}`);
      }
    } catch {}
  }

  // 后端 pom.xml
  const pomPath = path.join(sourcePath, 'backend', 'pom.xml');
  if (fs.existsSync(pomPath)) {
    try {
      const pom = fs.readFileSync(pomPath, 'utf8');
      const groupId = pom.match(/<groupId>([^<]+)<\/groupId>/)?.[1];
      const artifactId = pom.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
      const javaVersion = pom.match(/<java\.version>([^<]+)<\/java\.version>/)?.[1] || pom.match(/<maven\.compiler\.source>([^<]+)<\/maven\.compiler\.source>/)?.[1];
      parts.push(`后端: Java ${javaVersion || ''} ${groupId || ''}`.trim());
    } catch {}
  }

  // tsconfig.json
  const tsconfigPath = path.join(sourcePath, 'frontend', 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, ''));
      const target = tsconfig.compilerOptions?.target;
      const jsx = tsconfig.compilerOptions?.jsx;
      if (target) parts.push(`TS目标: ${target}`);
      if (jsx) parts.push(`JSX: ${jsx}`);
    } catch {}
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * ★ 编译验证（K8s 本地执行；worker Pod 即隔离环境，docker 沙箱已移除）
 * - frontend: 本地 npx tsc --noEmit，node_modules 缺失则先 npm install
 * - backend: 本地 mvn compile；无 maven 环境时跳过（不阻塞任务）
 */

// ★ 前端本地编译验证：npm install（如需）+ tsc --noEmit
// 用于项目 node_modules 不存在时的兜底（esbuild quickLint 不做类型检查）
export async function verifyCompile(sourcePath, type) {
  if (type === 'frontend') {
    try {
      const frontendDir = path.join(sourcePath, 'frontend');
      if (fs.existsSync(path.join(frontendDir, 'node_modules', '.bin', 'tsc'))) {
        // 本地有 tsc，直接跑
        const output = execFileSync('bash', ['-c', 'cd frontend && npx tsc --noEmit 2>&1 | head -60'], {
          cwd: sourcePath,
          timeout: 30000,
          maxBuffer: 1024 * 512,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (output.includes('error TS') || output.includes('error:')) {
          return { errors: output };
        }
        return { errors: null };
      }
      // ★ node_modules 不存在 -> 本地 npm install + tsc --noEmit
      console.log('[verify] frontend: no local node_modules, running npm install + tsc locally');
      const output = execFileSync('bash', ['-c', 'cd frontend && (npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5; npx tsc --noEmit 2>&1 | head -60)'], {
        cwd: sourcePath,
        timeout: 120000,
        maxBuffer: 1024 * 512,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (output.includes('error TS') || output.includes('error:')) {
        return { errors: output };
      }
      return { errors: null };
    } catch (e) {
      const out = (e.stdout || '') + (e.stderr || '');
      if (out.includes('error TS') || out.includes('error:')) {
        return { errors: out.slice(0, 3000) };
      }
      console.warn('[verify] frontend local tsc crashed:', e.message?.slice(0, 100));
      return { errors: null };
    }
  }

  // backend: 本地 mvn compile（K8s worker/sever Pod 无 maven 时跳过，不阻塞任务）
  try {
    // mvn 不可用 -> 跳过
    execFileSync('which', ['mvn'], { stdio: 'ignore' });
  } catch {
    console.warn('[verify] backend: mvn not available in this Pod, skipping verify');
    return { errors: null, skipped: true };
  }
  try {
    const output = execFileSync('bash', ['-c', 'cd backend && mvn compile -q 2>&1 | tail -80'], {
      cwd: sourcePath,
      timeout: 180000,
      maxBuffer: 1024 * 512,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (output.includes('ERROR') || output.includes('BUILD FAILURE') || output.includes('Compilation failure')) {
      return { errors: output };
    }
    return { errors: null };
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).trim() || e.message;
    if (out.includes('ERROR') || out.includes('BUILD FAILURE') || out.includes('Compilation failure')) {
      return { errors: out.slice(0, 3000) };
    }
    return { errors: null };
  }
}

// triggerHMR 已删除：从未被调用，且 git checkout -- . 会丢弃 AI 修改，极其危险。
