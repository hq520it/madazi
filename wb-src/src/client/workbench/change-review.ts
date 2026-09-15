/**
 * AI 改动审查 · 纯逻辑层（无 React / 无 DOM，可独立单测）
 *
 * 数据源：会话快照 ConversationSnapshot 的 ToolResultNode（dsh-client-runtime）。
 * 变更工具识别与官方 deliverables 同规则——认渲染意图不认工具名：
 *   callView 卡片是 diff（写/改文件），或 generic 且 kind==='edit'（str_replace_editor 的 insert）。
 * 读取类工具不产出、删除与失败调用不计入。
 *
 * 提供三层能力：
 *   1. 每轮改动收集 collectTurnChanges：按 turnEnds 的 seq 区间过滤变更节点，
 *      汇总 per-file 的近似行数统计（+N -M），供聊天侧改动条展示；
 *   2. unified diff hunk 解析 parseDiffHunks：把 git diff 文本切成带行号的块；
 *   3. 按块撤销 rejectHunks：把选中 hunk 的"新侧"行替换回"旧侧"行，重写全文。
 *      配合现有 /git/fs/write（expectedVersion 乐观锁）落盘，天然防并发覆盖。
 */

// —— 防御式结构类型（运行时来自 @deepseek-ai/dsh-client-* 各包，构建期不可见）——

/** dsh-tools presentation：FileDiff { path, oldText(null=新建), newText } */
export interface FileDiffLike {
  path: string
  oldText: string | null
  newText: string
}

interface LocationLike {
  path: string
}

/** call 侧渲染意图：diff 卡（带 diffs/locations）或 generic 卡（edit 时是变更） */
export type CallViewLike =
  | { card: 'diff'; diffs?: FileDiffLike[]; locations?: LocationLike[] }
  | { card: 'generic'; kind?: string; locations?: LocationLike[] }
  | { card: string }
  | null

/** result 侧渲染意图：DiffResultView 带"已应用的上下文 hunk" */
export type ResultViewLike =
  | { card: 'diff'; diffs?: FileDiffLike[] }
  | { card: string }
  | null

/** ConversationNode 里的 tool-result 节点（只取用得到的字段） */
export interface ToolResultNodeLike {
  kind: 'tool-result'
  seq: number
  isError: boolean
  callView: CallViewLike
  resultView: ResultViewLike
}

/** ConversationSnapshot 顶层字段（nodes + turnEnds）的最小结构 */
export interface ConversationNodesLike {
  nodes?: readonly unknown[]
  turnEnds?: ReadonlyMap<number, number>
}

/** 单文件本轮改动摘要 */
export interface FileChangeSummary {
  /** 会话 cwd 相对路径（与产物 chip 同源） */
  path: string
  /** 近似新增行数（来自 FileDiff 对；估算，精确值以 git diff 审查视图为准） */
  adds: number
  /** 近似删除行数 */
  dels: number
  /** 首个 diff 的 oldText 为 null（新建/整体覆写） */
  isNew: boolean
  /** 是否拿到过 diff 内容（generic edit 卡无内容，仅路径） */
  hasContent: boolean
}

// —— 变更节点识别（deliverables 同规则）——

/** 变更工具节点里能拿到的路径列表（callView.locations ∪ diff 卡的 diffs[].path） */
export function mutationPathsOf(view: CallViewLike): string[] {
  if (view === null || typeof view !== 'object') return []
  if (view.card === 'diff') {
    const out: string[] = []
    const seen = new Set<string>()
    for (const loc of view.locations ?? []) {
      if (typeof loc?.path === 'string' && loc.path !== '' && !seen.has(loc.path)) {
        seen.add(loc.path)
        out.push(loc.path)
      }
    }
    for (const diff of view.diffs ?? []) {
      if (typeof diff?.path === 'string' && diff.path !== '' && !seen.has(diff.path)) {
        seen.add(diff.path)
        out.push(diff.path)
      }
    }
    return out
  }
  if (view.card === 'generic' && view.kind === 'edit') {
    return (view.locations ?? [])
      .map(loc => (typeof loc?.path === 'string' ? loc.path : ''))
      .filter(path => path !== '')
  }
  return []
}

function isToolResultNode(node: unknown): node is ToolResultNodeLike {
  if (typeof node !== 'object' || node === null) return false
  const n = node as { kind?: unknown; isError?: unknown; callView?: unknown; resultView?: unknown }
  return n.kind === 'tool-result' && typeof (node as { seq?: unknown }).seq === 'number'
}

function resultDiffPairsOf(node: ToolResultNodeLike): FileDiffLike[] {
  const fromResult = node.resultView !== null && typeof node.resultView === 'object'
    && (node.resultView as { card?: unknown }).card === 'diff'
    ? (node.resultView as { diffs?: FileDiffLike[] }).diffs
    : undefined
  const fromCall = node.callView !== null && typeof node.callView === 'object'
    && (node.callView as { card?: unknown }).card === 'diff'
    ? (node.callView as { diffs?: FileDiffLike[] }).diffs
    : undefined
  const pairs = fromResult ?? fromCall
  if (!Array.isArray(pairs)) return []
  return pairs.filter((d): d is FileDiffLike =>
    typeof d?.path === 'string' && d.path !== '' && typeof d?.newText === 'string')
}

/** 节点归属的 seq 区间：(上一个已完成轮的 endSeq, 本轮 endSeq]；无上一轮记录则从 0 起 */
export function turnSeqRange(turnEnds: ReadonlyMap<number, number>, turn: number): { start: number; end: number } {
  let start = 0
  for (let n = turn - 1; n >= 1 && n >= turn - 50; n -= 1) {
    const end = turnEnds.get(n)
    if (end !== undefined) {
      start = end
      break
    }
  }
  const end = turnEnds.get(turn) ?? Number.POSITIVE_INFINITY
  return { start, end }
}

/**
 * 收集一轮的改动文件摘要（首见顺序、去重，与 deliverables 产物列表一致）。
 * 失败调用不计入；同一文件先写后改只记一条（统计聚合全部 diff 对）。
 */
export function collectTurnChanges(
  snapshot: ConversationNodesLike,
  turn: number,
): FileChangeSummary[] {
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  const turnEnds = snapshot.turnEnds
  const { start, end } = turnEnds instanceof Map
    ? turnSeqRange(turnEnds, turn)
    : { start: 0, end: Number.POSITIVE_INFINITY }
  const byPath = new Map<string, FileChangeSummary & { pairs: FileDiffLike[] }>()
  for (const node of nodes) {
    if (!isToolResultNode(node)) continue
    if (node.isError === true) continue
    if (node.seq <= start || node.seq > end) continue
    const paths = mutationPathsOf(node.callView)
    if (paths.length === 0) continue
    const pairs = resultDiffPairsOf(node)
    for (const path of paths) {
      let entry = byPath.get(path)
      if (entry === undefined) {
        entry = { path, adds: 0, dels: 0, isNew: false, hasContent: false, pairs: [] }
        byPath.set(path, entry)
      }
      if (pairs.length > 0) entry.hasContent = true
      for (const pair of pairs) {
        if (pair.path !== path) continue
        entry.pairs.push(pair)
      }
    }
  }
  const out: FileChangeSummary[] = []
  for (const entry of byPath.values()) {
    if (entry.pairs.length > 0) entry.isNew = entry.pairs[0]!.oldText === null
    for (const pair of entry.pairs) {
      const delta = lineDelta(pair.oldText, pair.newText)
      entry.adds += delta.adds
      entry.dels += delta.dels
    }
    out.push({ path: entry.path, adds: entry.adds, dels: entry.dels, isNew: entry.isNew, hasContent: entry.hasContent })
  }
  return out
}

/**
 * 全窗口（所有轮次）出现过的变更路径集合——比"最近一轮"更宽，
 * 供聊天侧文件点击分流：命中集合的路径改开 diff 审查，其余开普通编辑器。
 */
export function collectChangedPaths(snapshot: ConversationNodesLike): ReadonlySet<string> {
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  const out = new Set<string>()
  for (const node of nodes) {
    if (!isToolResultNode(node)) continue
    if (node.isError === true) continue
    for (const path of mutationPathsOf(node.callView)) out.add(path)
  }
  return out
}

/** 快照里最近一个已完成轮的轮号（无则 undefined） */
export function latestCompletedTurn(turnEnds: ReadonlyMap<number, number> | undefined): number | undefined {
  if (!(turnEnds instanceof Map) || turnEnds.size === 0) return undefined
  let max: number | undefined
  for (const turn of turnEnds.keys()) {
    if (max === undefined || turn > max) max = turn
  }
  return max
}

// —— 行数统计 ——

function countLines(text: string): number {
  if (text === '') return 0
  const parts = text.split('\n')
  return text.endsWith('\n') ? parts.length - 1 : parts.length
}

/** LCS 行差异的规模上限：超过则退化为粗估（整对 old/new 行数），防大文件卡 UI */
const LCS_LINE_CAP = 1500

/** 一对文本的行级 +N -M（小文本走 LCS；null 旧行=新建；超限走粗估） */
export function lineDelta(oldText: string | null, newText: string): { adds: number; dels: number } {
  if (oldText === null) return { adds: countLines(newText), dels: 0 }
  const oldLines = oldText === '' ? [] : oldText.split('\n')
  const newLines = newText === '' ? [] : newText.split('\n')
  if (oldLines.length > LCS_LINE_CAP || newLines.length > LCS_LINE_CAP) {
    return { adds: newLines.length, dels: oldLines.length }
  }
  // 经典 LCS DP：dp[i][j] = oldLines[i:] 与 newLines[j:] 的最长公共子序列长度
  const m = oldLines.length
  const n = newLines.length
  const width = n + 1
  const dp = new Int32Array((m + 1) * width)
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i * width + j] = oldLines[i] === newLines[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }
  const lcs = dp[0]
  return { adds: n - lcs, dels: m - lcs }
}

// —— unified diff hunk 解析 ——

export type DiffRowKind = 'add' | 'del' | 'ctx'

export interface DiffRow {
  kind: DiffRowKind
  /** 去掉行首 +/-/空格 前缀后的行文本 */
  text: string
}

export interface DiffHunk {
  /** 在 parseDiffHunks 结果中的序号（稳定标识，撤销按此引用） */
  index: number
  /** 原始 @@ 头 */
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  rows: DiffRow[]
}

function isMetaLine(line: string): boolean {
  return line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ')
    || line.startsWith('+++ ') || line.startsWith('new file ') || line.startsWith('deleted file ')
    || line.startsWith('old mode ') || line.startsWith('new mode ') || line.startsWith('rename from ')
    || line.startsWith('rename to ') || line.startsWith('copy from ') || line.startsWith('copy to ')
    || line.startsWith('similarity index') || line.startsWith('Binary files ') || line.startsWith('GIT binary patch')
}

function parseHunkHeader(line: string): { oldStart: number; oldCount: number; newStart: number; newCount: number } | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
  if (m === null) return null
  const oldStart = Number(m[1])
  const oldCount = m[2] === undefined ? 1 : Number(m[2])
  const newStart = Number(m[3])
  const newCount = m[4] === undefined ? 1 : Number(m[4])
  return { oldStart, oldCount, newStart, newCount }
}

/** 把 unified diff 文本切成 hunk 列表（跳过文件头与 "\ No newline" 行） */
export function parseDiffHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  if (typeof diffText !== 'string' || diffText.trim() === '') return hunks
  const lines = diffText.split(/\r?\n/)
  let current: DiffHunk | null = null
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const parsed = parseHunkHeader(line)
      if (parsed !== null) {
        current = {
          index: hunks.length,
          header: line,
          oldStart: parsed.oldStart,
          oldCount: parsed.oldCount,
          newStart: parsed.newStart,
          newCount: parsed.newCount,
          rows: [],
        }
        hunks.push(current)
      }
      continue
    }
    if (current === null || isMetaLine(line)) continue
    if (line.startsWith('\\')) continue // "\ No newline at end of file"
    if (line.startsWith('+')) current.rows.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) current.rows.push({ kind: 'del', text: line.slice(1) })
    else current.rows.push({ kind: 'ctx', text: line.slice(1) })
  }
  return hunks
}

// —— 按块撤销：内容重建 ——

/** hunk 的旧侧行（ctx + del 按序）——撤销后该区域应有的内容 */
export function hunkOldSide(hunk: DiffHunk): string[] {
  const out: string[] = []
  for (const row of hunk.rows) {
    if (row.kind === 'add') continue
    out.push(row.text)
  }
  return out
}

/** hunk 的新侧行（ctx + add 按序）——应与当前文件对应区域一致 */
export function hunkNewSide(hunk: DiffHunk): string[] {
  const out: string[] = []
  for (const row of hunk.rows) {
    if (row.kind === 'del') continue
    out.push(row.text)
  }
  return out
}

/**
 * 把 content 中选中 hunk 的新侧区域替换回旧侧行（即撤销这些改动块）。
 *
 * 校验：hunk 新侧必须与 content 对应区域逐行一致（diff 未过期）；不一致返回 null，
 * 调用方应提示并刷新 diff。返回 null 也涵盖 newCount 越界（文件比 diff 短）。
 */
export function rejectHunks(content: string, hunks: DiffHunk[], rejectIndexes: ReadonlySet<number>): string | null {
  if (rejectIndexes.size === 0) return content
  const lines = content.split('\n')
  const picked = hunks.filter(h => rejectIndexes.has(h.index))
  if (picked.length === 0) return content
  // 倒序处理（newStart 从大到小），前面的下标不受影响
  const ordered = [...picked].sort((a, b) => b.newStart - a.newStart)
  for (const hunk of ordered) {
    const from = hunk.newStart - 1
    const to = from + hunk.newCount
    if (from < 0 || to > lines.length) return null
    const expected = hunkNewSide(hunk)
    for (let i = 0; i < expected.length; i += 1) {
      if (lines[from + i] !== expected[i]) return null
    }
    lines.splice(from, hunk.newCount, ...hunkOldSide(hunk))
  }
  return lines.join('\n')
}

// —— 聊天侧 ↔ 工作台 事件总线（工作台拥有 tab 状态，改动条只发意图）——

export interface OpenDiffRequest {
  /** 会话 cwd 相对路径 */
  path: string
  /** 打开时同时展开工作台编辑器列 */
  focus?: boolean
}

type ChangeReviewListener = (request: OpenDiffRequest) => void

const listeners = new Set<ChangeReviewListener>()

/** 改动条 / 其它聊天侧入口请求打开某文件的 diff 审查视图 */
export function emitOpenDiffReview(request: OpenDiffRequest): void {
  for (const listener of listeners) {
    try {
      listener(request)
    } catch (err) {
      console.error('change-review listener failed', err)
    }
  }
}

/** 工作台订阅打开审查请求（Workbench 挂载期间有效） */
export function subscribeOpenDiffReview(listener: ChangeReviewListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
