import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as fs from 'node:fs'
import * as path from 'node:path'

// 截图落盘目录 + 静态 URL（dsh web 同源提供，登录可见）
// ★ 省 token 核心：base64 只在 注入脚本→client→host 内部流转，写文件后工具只返回小文本（路径/URL/大小）
const SHOT_DIR = '/tmp/madazi-shots'
const SHOT_URL_PREFIX = '/git/browser-shot'

/**
 * Browser agent control (AI-driven, 2026-08-28)
 *
 * 让 dsh agent 控制用户正在看的 BrowserView 内置浏览器，做修复验证 / 自动化测试。
 *
 * 通道（复用现有机制，零新网络层）：
 *   agent 工具(host, ctx.tools) → 指令队列 + pending Promise
 *   client 指令泵: GET /git/browser-command（HTTP 长轮询，挂起直到有指令）
 *     → BrowserView iframe postMessage → 注入脚本执行(snapshot/click/type/eval/wait/verify_text)
 *     → POST /git/browser-result 回传 → resolve pending → 工具返回
 *
 * 工具命名对齐 Playwright MCP 标准（browser_snapshot/click/type/evaluate/wait/verify_text_visible）。
 */
interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
  /** 指令发起会话（dsh 共享单实例：指令必须归属发起会话，防跨会话/跨 tab 串台） */
  sessionId: string
  /** 实际执行窗口（结果校验基准：只认该窗口回传的结果；派发时更新） */
  targetTab?: string
}

const queue: Array<Record<string, unknown>> = []
const pending = new Map<string, Pending>()
let seq = 0
// 公网 Host（从浏览器端点请求头捕获）：用于给 AI 计算当前项目预览域名（pv-<pid8>.<domain>）
let publicHost = ''
const CMD_TIMEOUT = 60_000 // agent 工具等待结果超时
const POLL_TIMEOUT = 25_000 // HTTP 长轮询单次挂起上限（n 秒无指令返回空，client 续拉）
const TAKEOVER_IDLE_MS = 60_000 // AI 操控接管窗口：60s 无浏览器操作自动结束接管

// ── 活跃响应者注册表（2026-09-01 多人协同隔离）──
// dsh 为共享单实例：同一会话可能在多标签/多设备/多处登录同时挂着指令泵，
// 旧实现 queue 全局 shift() + result 无归属校验 → 指令被别的窗口抢走执行、结果串台、
// 覆盖层在非执行窗口显示。现在：
//   1) 指令入队带发起 sessionId（exec.agent.session.id）
//   2) 客户端泵长轮询带 ?session=<sid>&tab=<tabId> 心跳注册，host 只认每个会话
//      最近心跳的 tab 为「活跃响应者」→ 指令定向派发，同会话多处登录只响应一个地方
//   3) 结果回传校验发送者是活跃响应者才 resolve
//   4) takeover 状态按会话隔离（Map<sid, state>），不再全局单例
// ★ 泵心跳注册：tab = 客户端「泵心跳令牌」（窗口基 + ":" + sessionId），
//   与 dsh browser tab id（browser:<ts>-<seq>）解耦——browser tab 由前端懒创建，
//   心跳必须先于首次指令存在。每个会话只认最近心跳令牌为活跃响应者。
const activeTabs = new Map<string, { tab: string; lastAt: number }>()
const ACTIVE_TTL_MS = 120_000
setInterval(() => {
  const now = Date.now()
  for (const [sid, t] of activeTabs) {
    if (now - t.lastAt > ACTIVE_TTL_MS) activeTabs.delete(sid)
  }
}, 30_000)

// 会话级接管状态：sessionId -> { active, lastActivity }
const takeoverBySession = new Map<string, { active: boolean; lastActivity: number }>()

// ★ 2026-09-04 用户接管（全局，按会话）：用户在任何窗口点「我来接管」→ 上报本端点，
//   server 记录该会话被用户接管 → runCommand 挂起等待 AI 的 browser 工具（waitForUserRelease）
//   → 120s 自动过期。彻底解决多窗口竞争时「指令派给带锁窗口导致 UI 与报错矛盾、
//   AI 反复撞锁」——接管是会话级事实，不再受「哪个窗口执行」影响。
// ★ 2026-09-05 活跃续期：TTL 90→120s，且 client 在用户活跃时重报 takeover（时间戳覆盖
//   即续期，幂等）→ 「用户在操作就持有控制；停止活动 120s（走开）才放行 AI」。
const USER_TAKEOVER_TTL = 120_000
const userTakeoverBySession = new Map<string, number>()

function isUserTakeover(sid: string): boolean {
  if (!sid) return false
  const at = userTakeoverBySession.get(sid)
  if (!at) return false
  if (Date.now() - at > USER_TAKEOVER_TTL) { userTakeoverBySession.delete(sid); return false }
  return true
}

// 用户接管上报端点：POST /git/browser-takeover {sessionId, action:'takeover'|'release'}
function createTakeoverHandler() {
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(200, { 'Content-Type': 'application/json' })
    try {
      const { sessionId, action } = JSON.parse(body || '{}')
      if (!sessionId) { res.end(JSON.stringify({ ok: false, error: '缺少 sessionId' })); return }
      if (action === 'takeover') userTakeoverBySession.set(sessionId, Date.now())
      else userTakeoverBySession.delete(sessionId)
      res.end(JSON.stringify({ ok: true, takenOver: isUserTakeover(sessionId) }))
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  }
}

// ★ 2026-09-04 发起者定向派发（prompt 权威版）：会话「最近发消息的用户」由网关
//   （madazi-server 拦截 session/prompt，cookie 身份权威识别）推送——无论输入框回车
//   还是 AI 快捷选择，所有发消息路径都汇聚到同一 RPC 拦截点，彻底替代浏览器侧
//   pointerdown/keydown 交互启发式（任何窗口随便点一下就会偷走发起者身份，
//   无法区分「发消息」与「旁观点击」）。host 在每轮首个浏览器指令时把发起者
//   解析成具体窗口（该用户的心跳 tab）并锁定整轮（防处理中途他人发消息把指令
//   窗口漂走）→ 指令/呼吸层/接管按钮只落在发起者窗口；turn/end 解锁。
//   发起者窗口失活（关窗/刷新，心跳超时）→ 指令回退活跃响应者派发（不悬挂）。
const INITIATOR_TTL = 10 * 60_000 // prompt→首个浏览器指令的间隔上限（覆盖慢轮次）
const initiatorBySession = new Map<string, { uid: string; lastAt: number }>()
// 每用户心跳注册：sid -> uid -> {tab, lastAt}（降级：发起者窗口失活时按用户取最近心跳）
const userTabs = new Map<string, Map<string, { tab: string; lastAt: number }>>()
// 窗口获焦注册：sid -> {tab, uid, at}——用户在哪个窗口打字/点按钮，那个窗口就持焦。
//   ★ 同用户多窗口不漂移的主路径（cookie 会跨标签共享、心跳分不出同用户多窗口，
//   唯有焦点是「正在此窗口交互」的可靠信号：发消息前必有焦点）
const focusBySession = new Map<string, { tab: string; uid: string; at: number }>()
// tab 存活表（定向指令的失活回退依据）：tab -> lastAt
const tabLastSeen = new Map<string, number>()
// 本轮派发目标锁：sid -> {tab, at}——本轮首个浏览器指令时解析，整轮沿用，
//   turn/end 释放。锁定期间该会话所有浏览器指令（含 takeover 广播）同窗。
const TURN_TARGET_TTL = 10 * 60_000
const turnTarget = new Map<string, { tab: string; at: number }>()

// 解析会话当前派发目标窗口：发起者获焦窗口（同用户多窗口精确归位）→
//   失焦降级该用户最近心跳窗口 → 再降级会话最近心跳 tab
function resolveTargetTab(sid: string): string {
  const init = initiatorBySession.get(sid)
  if (init && Date.now() - init.lastAt < INITIATOR_TTL) {
    const fc = focusBySession.get(sid)
    if (fc && fc.uid === init.uid && Date.now() - fc.at < INITIATOR_TTL) return fc.tab
    const ut = userTabs.get(sid)?.get(init.uid)
    if (ut && Date.now() - ut.lastAt < ACTIVE_TTL_MS) return ut.tab
  }
  return activeTabs.get(sid)?.tab ?? ''
}

// 指令入队前盖「目标窗口」章：本轮已锁 → 沿用；否则解析发起者窗口并锁定
function stampTarget(cmd: Record<string, unknown>, sid: string): string {
  let tab = ''
  const lock = turnTarget.get(sid)
  if (lock && Date.now() - lock.at < TURN_TARGET_TTL) tab = lock.tab
  if (!tab) {
    tab = resolveTargetTab(sid)
    if (tab) turnTarget.set(sid, { tab, at: Date.now() })
  }
  if (tab) cmd.targetTab = tab
  return tab
}

// 发起者上报端点：POST /git/browser-initiator {sessionId, userId}（网关 prompt 拦截推送）
function createInitiatorHandler() {
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(200, { 'Content-Type': 'application/json' })
    try {
      const { sessionId, userId } = JSON.parse(body || '{}')
      if (!sessionId || !userId) { res.end(JSON.stringify({ ok: false, error: '缺少 sessionId/userId' })); return }
      const uid = String(userId)
      initiatorBySession.set(sessionId, { uid, lastAt: Date.now() })
      // ★ 发消息时刻的焦点快照：发起用户此刻聚焦的窗口 = 发起窗口 → 立即锁定本轮目标
      //   （比首个浏览器指令时才解析更忠实——中途切窗口偷不走发起权；焦点缺失则不锁，
      //   由 stampTarget 指令时按 focus → userTabs → activeTabs 降级解析）
      const fc = focusBySession.get(sessionId)
      if (fc && fc.uid === uid && Date.now() - fc.at < INITIATOR_TTL) {
        turnTarget.set(sessionId, { tab: fc.tab, at: Date.now() })
      }
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  }
}

// 窗口获焦上报端点：POST /git/browser-focus {sessionId, tab, userId}
//   插件在 focus 事件/会话切换时上报（tab = 心跳令牌，窗口级唯一）。
//   写 focusBySession 并清掉同 tab 在其他会话的旧焦点（一窗一时刻只聚焦一个会话）。
function createFocusHandler() {
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(200, { 'Content-Type': 'application/json' })
    try {
      const { sessionId, tab, userId } = JSON.parse(body || '{}')
      if (!sessionId || !tab || !userId) { res.end(JSON.stringify({ ok: false })); return }
      const sid = String(sessionId)
      focusBySession.set(sid, { tab: String(tab), uid: String(userId), at: Date.now() })
      for (const [s, fc] of focusBySession) {
        if (s !== sid && fc.tab === String(tab)) focusBySession.delete(s)
      }
      res.end(JSON.stringify({ ok: true }))
    } catch {
      res.end(JSON.stringify({ ok: false }))
    }
  }
}

// 当前会话项目 ID：从会话 cwd（/app/generated/<uuid>）解析
function projectIdOf(exec: { agent?: { session?: { header?: { cwd?: string } } } } | undefined): string {
  const cwd = exec?.agent?.session?.header?.cwd ?? ''
  return cwd.match(/\/generated\/([0-9a-fA-F-]{36})/)?.[1] ?? ''
}

// 指令发起会话 ID（dsh Session 对象 id，形如 session-xxx；与客户端 sessions.list.current 同源）
function sessionIdOf(exec: unknown): string {
  const s = exec as { agent?: { session?: { id?: string } } } | undefined
  return s?.agent?.session?.id ?? ''
}

// 当前项目预览域名（每个项目预览有独立 pv-<pid8>.<domain>）：从会话 cwd（/app/generated/<uuid>）解析
function previewUrlOf(exec: { agent?: { session?: { header?: { cwd?: string } } } } | undefined): string {
  const pid = projectIdOf(exec)
  if (!pid || publicHost === '') return ''
  const domain = publicHost.split('.').slice(1).join('.')
  if (domain === '') return ''
  return `https://pv-${pid.slice(0, 8)}.${domain}/`
}

// 会话级接管维护（host 侧）：任何 browser_* 操作自动声明接管（客户端显示指示），
// AI 本轮对话结束（session/event turn/end）→ 精确结束接管（隐藏）；60s 惰性定时器兜底
function ensureTakeoverActive(sid: string): void {
  if (!sid) return
  const st = takeoverBySession.get(sid)
  if (!st?.active) {
    takeoverBySession.set(sid, { active: true, lastActivity: Date.now() })
    // ★ 盖目标窗口章：呼吸层/takeover 按钮只落在发起者窗口（与后续操作指令同窗）
    const cmd: Record<string, unknown> = { type: 'takeover', action: 'start', id: `auto${++seq}`, sessionId: sid }
    stampTarget(cmd, sid)
    queue.push(cmd)
  } else {
    st.lastActivity = Date.now()
  }
}

function stopTakeover(sid: string): void {
  const st = takeoverBySession.get(sid)
  if (st?.active) {
    st.active = false
    // ★ 盖章：stop 广播发给显示 overlay 的同一窗口（本轮锁定目标），避免残留
    const cmd: Record<string, unknown> = { type: 'takeover', action: 'stop', id: `auto${++seq}`, sessionId: sid }
    stampTarget(cmd, sid)
    queue.push(cmd)
  }
}

function pushCommand(cmd: Record<string, unknown>): void {
  queue.push(cmd)
}

/** 定向派发：带 targetTab 的指令只派给该窗口（★ 绕过 activeTabs 翻转竞争——
 *   多窗口轮流心跳时定向指令不受影响）；目标失活（发起者关窗）回退活跃响应者；
 *   未标记的（legacy/无会话归属）仍按活跃响应者派发 */
function nextCommandFor(sid: string, tab: string): Record<string, unknown> | null {
  // 无身份 → 一律不给（fail-closed，防跨 tab 抢指令）
  if (!sid || !tab) return null
  for (let i = 0; i < queue.length; i++) {
    const cmd = queue[i]
    const cmdSid = (cmd.sessionId as string) || ''
    // 归属自己（或未解析到会话的向后兼容指令）才派发
    if (cmdSid !== '' && cmdSid !== sid) continue
    const target = (cmd.targetTab as string) || ''
    const targetAlive = target !== '' && (tabLastSeen.get(target) ?? 0) > Date.now() - ACTIVE_TTL_MS
    if (target === '' || !targetAlive) {
      // 未标记 / 目标失活 → 活跃响应者派发（发起者窗口已关，不悬挂指令）
      const active = activeTabs.get(sid)
      if (!active || active.tab !== tab) continue
    } else if (target !== tab) {
      continue // 定向指令：只给目标窗口
    }
    queue.splice(i, 1)
    // 结果校验基准 = 实际执行窗口（回退派发时同步更新 pending 记录）
    const p = pending.get(String(cmd.id))
    if (p) p.targetTab = tab
    return cmd
  }
  return null
}

/** client 泵 GET：长轮询挂起直到有指令（或超时返回空）；带 session/tab/user 心跳注册 */
function createCommandHandler() {
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    if (req.headers.host) publicHost = req.headers.host
    const url = new URL(req.url ?? '/', 'http://localhost')
    const sid = url.searchParams.get('session') ?? ''
    const tab = url.searchParams.get('tab') ?? ''
    const uid = url.searchParams.get('user') ?? ''
    // 心跳记档：每次轮询续期；最近心跳的 tab 成为该会话的活跃响应者
    if (sid && tab) {
      const now = Date.now()
      activeTabs.set(sid, { tab, lastAt: now })
      tabLastSeen.set(tab, now)
      // ★ 用户级心跳注册：发起者（userId）→ 其窗口的映射依据（焦点缺失时的降级路径）
      if (uid) {
        let m = userTabs.get(sid)
        if (!m) { m = new Map(); userTabs.set(sid, m) }
        m.set(uid, { tab, lastAt: now })
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    const deadline = Date.now() + POLL_TIMEOUT
    const trySend = (): boolean => {
      const cmd = nextCommandFor(sid, tab)
      if (cmd) { res.end(JSON.stringify(cmd)); return true }
      return false
    }
    if (trySend()) return
    const iv = setInterval(() => {
      if (trySend()) clearInterval(iv)
      else if (Date.now() > deadline) { clearInterval(iv); res.end(JSON.stringify({ id: null })) }
    }, 150)
    req.on('close', () => clearInterval(iv))
  }
}

/** 截图静态服务：GET /git/browser-shot/<name> */
function serveShot(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
  const name = path.basename(req.url || '')
  const file = path.join(SHOT_DIR, name)
  if (name === '' || name === '.' || name === '..' || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

/** client 泵 POST 结果：resolve pending[cmd.id]；★ 校验发送者是实际执行窗口
 *   （定向指令只有目标窗口能收到 → 结果也只认该窗口，防串台） */
function createResultHandler() {
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    if (req.headers.host) publicHost = req.headers.host
    let body = ''
    for await (const chunk of req) body += chunk
    res.writeHead(200, { 'Content-Type': 'application/json' })
    try {
      const { id, result, session, tab } = JSON.parse(body || '{}')
      const p = id && pending.get(String(id))
      if (p) {
        // ★ 归属校验：定向指令只认目标窗口回传的结果；未定向的（legacy）认活跃响应者
        //   （防跨 tab/跨会话串台——旧实现任何客户端 POST 任意 id 都能 resolve）
        const okSender = p.targetTab !== undefined
          ? p.targetTab === tab
          : p.sessionId === '' || (activeTabs.get(p.sessionId)?.tab ?? '') === tab
        if (okSender) { clearTimeout(p.timer); pending.delete(String(id)); p.resolve(result) }
      }
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  }
}

/** ★ 等待用户接管结束：挂起而非拒绝——用户点「我来接管」后（协助登录/手动操作），
 *   AI 的浏览器工具调用在此等待，直到用户点「恢复 AI 控制」或 120s TTL 自动过期
 *   （用户活跃时 client 持续续期，走开 120s 才真正放行），然后命令无缝继续执行。
 *   期间 AI 回合保持活跃（turn 不结束），用户操作完交回控制 AI 直接续上，无需
 *   重新发消息。abort（用户点「停止生成」）立即取消。
 *   ★ 不设总时长兜底：按总时长强制放行会在「用户活跃续期长时间操作」时把控制
 *     从用户手里抢回来（AI 抢鼠标）；TTL 过期由 isUserTakeover 按时间戳判定，
 *     续期停了自然会放行，时钟停摆则整个系统都不可用，无需在此防御。 */
function waitForUserRelease(sid: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (signal?.aborted) { clearInterval(iv); reject(new Error('browser 指令已取消（用户停止生成）: 用户接管等待中')); return }
      if (!isUserTakeover(sid)) { clearInterval(iv); resolve(); return }
    }, 300)
  })
}

/** 入队并挂起，等 client 执行结果；noTakeover=true 时不声明浏览器接管（如 preview_* 指令）
 * signal：agent 取消信号（用户点「停止生成」）→ 立即结束 pending，让工具可被中断
 * exec：agent 执行上下文（取发起会话 id，指令定向派发归属） */
async function runCommand(cmd: Record<string, unknown>, timeoutMs: number = CMD_TIMEOUT, signal?: AbortSignal, exec?: unknown): Promise<unknown> {
  const sid = sessionIdOf(exec)
  // ★ 2026-09-05 用户接管改为「挂起等待」：旧实现立即 reject → AI 把它当普通错误，
  //   输出一句"我暂停了"就 turn/end 收工（实测日志：接管后 4.6s 回合即结束），
  //   用户点「恢复 AI 控制」时 AI 早已放手，没有续上机制。现在工具调用挂起等待
  //   release/TTL/abort，用户交回控制后命令继续执行，AI 无缝续上。
  //   preview_*（noTakeover）与 takeover 指令不受此限（预览启停/解锁是元操作）。
  if (cmd.type !== 'takeover' && cmd.noTakeover !== true && isUserTakeover(sid)) {
    await waitForUserRelease(sid, signal)
  }
  // ★ 盖目标窗口章：本轮首个浏览器指令时解析发起者（网关 prompt 拦截记录）→ 其心跳
  //   窗口并锁定整轮；takeover-start 与本指令同窗 → 呼吸层/接管按钮只在发起者窗口
  const targetTab = stampTarget(cmd, sid)
  if (cmd.type !== 'takeover' && cmd.noTakeover !== true) ensureTakeoverActive(sid)
  const id = `c${++seq}`
  return new Promise((resolve, reject) => {
    const finish = (timer: NodeJS.Timeout) => { if (signal) signal.removeEventListener('abort', onAbort); clearTimeout(timer); pending.delete(id) }
    const onAbort = () => { finish(timer); reject(new Error(`browser 指令已取消（用户停止生成）: ${String(cmd.type)}`)) }
    const timer = setTimeout(() => { finish(timer); reject(new Error(`browser 指令超时: ${String(cmd.type)}`)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer, sessionId: sid, targetTab: targetTab || undefined })
    if (signal) {
      if (signal.aborted) { onAbort(); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    pushCommand({ ...cmd, id, sessionId: sid })
  })
}

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true, properties: {} },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

export function registerBrowserAgent(ctx: Context): void {
  const server = ctx.webServer
  if (server !== undefined) {
    ctx.effect(() => server.register({ kind: 'exact', path: '/git/browser-command', handler: createCommandHandler() }), 'workbench: browser-command')
    ctx.effect(() => server.register({ kind: 'exact', path: '/git/browser-result', handler: createResultHandler() }), 'workbench: browser-result')
    ctx.effect(() => server.register({ kind: 'exact', path: '/git/browser-takeover', handler: createTakeoverHandler() }), 'workbench: browser-takeover')
    ctx.effect(() => server.register({ kind: 'exact', path: '/git/browser-initiator', handler: createInitiatorHandler() }), 'workbench: browser-initiator')
    ctx.effect(() => server.register({ kind: 'exact', path: '/git/browser-focus', handler: createFocusHandler() }), 'workbench: browser-focus')
    ctx.effect(() => server.register({ kind: 'prefix', path: SHOT_URL_PREFIX, handler: serveShot }), 'workbench: browser-shot')
  }
  // 惰性结束接管（兜底）：60s 无浏览器操作 → 自动隐藏接管指示（主路径是 turn/end 精确结束）
  const takeoverIdle = setInterval(() => {
    const now = Date.now()
    for (const [sid, st] of takeoverBySession) {
      if (st.active && now - st.lastActivity > TAKEOVER_IDLE_MS) stopTakeover(sid)
    }
    // ★ 2026-09-04 顺带清理过期的用户接管（90s 自动释放后从 Map 移除）
    for (const [sid, at] of userTakeoverBySession) {
      if (now - at > USER_TAKEOVER_TTL) userTakeoverBySession.delete(sid)
    }
    // ★ 2026-09-04 清理过期的发起者记录（prompt 权威版：超时未触发浏览器指令则失效）
    for (const [sid, init] of initiatorBySession) {
      if (now - init.lastAt > INITIATOR_TTL) initiatorBySession.delete(sid)
    }
    // ★ 清理失活的心跳注册：用户窗口表 / 焦点表 / tab 存活表 / 本轮目标锁
    for (const [sid, m] of userTabs) {
      for (const [uid, t] of m) {
        if (now - t.lastAt > ACTIVE_TTL_MS) m.delete(uid)
      }
      if (m.size === 0) userTabs.delete(sid)
    }
    for (const [sid, fc] of focusBySession) {
      if (now - fc.at > INITIATOR_TTL) focusBySession.delete(sid)
    }
    for (const [tab, at] of tabLastSeen) {
      if (now - at > ACTIVE_TTL_MS) tabLastSeen.delete(tab)
    }
    for (const [sid, t] of turnTarget) {
      if (now - t.at > TURN_TARGET_TTL) turnTarget.delete(sid)
    }
  }, 15_000)
  ctx.effect(() => clearInterval(takeoverIdle), 'workbench: takeover idle')
  // 精确结束：AI 本轮对话完成（turn/end 会话事件）→ 结束该会话的接管（覆盖层隐藏）
  //   ★ 并释放本轮派发目标锁（takeover-stop 先继承锁定窗口盖章，再解锁下一轮）
  const handleSessionEvent = (...args: unknown[]) => {
    const [session, event] = args
    const ev = event as { type?: string } | undefined
    if (ev?.type === 'turn/end') {
      const sid = (session as { id?: string } | undefined)?.id ?? ''
      if (sid) {
        stopTakeover(sid)
        turnTarget.delete(sid)
      }
    }
  }
  ctx.effect(() => ctx.on('session/event', handleSessionEvent) as unknown as () => void, 'workbench: browser session/event')

  ctx.tools.register(defineTool({
    name: 'browser_snapshot',
    description: '获取内置浏览器当前页面的可交互元素快照（含 ref 定位符 + 标签/文本/值）。执行任何点击/输入前必须先 snapshot 拿 ref。',
    parameters: {},
    output: OUTPUT,
    execute: (_args, exec) => runCommand({ type: 'snapshot' }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: '按 ref 点击内置浏览器页面的元素（ref 来自 browser_snapshot）。用户可实时看到 AI 操作。★ 添加/修改/删除页面数据时，用本工具在页面上操作（用户实时看到协同过程、页面即时刷新）；不要用 shell/preview_exec 直接改数据库或调 API——那样页面不会实时刷新，用户看不到过程。',
    parameters: { ref: { type: 'number', required: true, description: '快照返回的元素 ref' } },
    output: OUTPUT,
    execute: (args: { ref: number }, exec) => runCommand({ type: 'click', ref: args.ref }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_type',
    description: '向输入框输入文本（ref 来自 snapshot）。submit=true 时提交表单/按 Enter。★ 添加数据时先 browser_snapshot 定位表单输入框 → browser_type 输入 → submit=true 提交，用户全程实时可见、页面即时展示新数据。',
    parameters: {
      ref: { type: 'number', required: true, description: '快照返回的元素 ref' },
      text: { type: 'string', required: true, description: '要输入的文本' },
      submit: { type: 'boolean', description: '输入后提交' },
    },
    output: OUTPUT,
    execute: (args: { ref: number; text: string; submit?: boolean }, exec) => runCommand({ type: 'type', ref: args.ref, text: args.text, submit: !!args.submit }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_wait',
    description: '等待：ms 毫秒，或直到 CSS selector 出现（最长 15s）。',
    parameters: { ms: { type: 'number', description: '等待毫秒' }, selector: { type: 'string', description: '等待出现的 CSS 选择器' } },
    output: OUTPUT,
    execute: (args: { ms?: number; selector?: string }, exec) => runCommand({ type: 'wait', ms: args.ms, selector: args.selector }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_evaluate',
    description: '在内置浏览器页面执行 JavaScript，返回序列化结果（调试/读取状态/断言用）。',
    parameters: { code: { type: 'string', required: true, description: '要执行的 JS' } },
    output: OUTPUT,
    execute: (args: { code: string }, exec) => runCommand({ type: 'eval', code: args.code }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_verify_text_visible',
    description: '断言内置浏览器页面包含指定文本（修复验证/自动化测试验收）。',
    parameters: { text: { type: 'string', required: true, description: '要验证的文本' } },
    output: OUTPUT,
    execute: (args: { text: string }, exec) => runCommand({ type: 'verify_text', text: args.text }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_take_screenshot',
    description: '截取内置浏览器当前视口（JPEG 压缩）。保存到项目 screenshots/ 目录，返回文件路径——在左侧文件浏览器可查看/下载。不占用对话 token。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute: async (_args, exec) => {
      const result = (await runCommand({ type: 'screenshot' }, CMD_TIMEOUT, exec?.signal, exec)) as { ok?: boolean; error?: string; data?: { type?: string; url?: string } }
      const url = result?.ok && result?.data?.url ? result.data.url : ''
      if (!url) return { ok: false, error: result?.error || '截图失败' }
      const b64 = url.includes(',') ? url.slice(url.indexOf(',') + 1) : ''
      if (!b64) return { ok: false, error: '截图数据异常' }
      let buf: Buffer
      try { buf = Buffer.from(b64, 'base64') } catch { return { ok: false, error: '截图解码失败' } }
      // 保存到当前项目目录 screenshots/（文件浏览器可见、可下载、随项目走）
      // ★ exec.cwd 不存在（dsh exec 上下文是 {token,callId,name,arguments,signal,agent,parent}）；
      //   项目目录取自会话 header.cwd（与 git_* 工具同一来源，见 host/tools.ts cwdOf）
      const cwd = typeof exec?.agent?.session?.header?.cwd === 'string' && exec.agent.session.header.cwd !== '' ? exec.agent.session.header.cwd : ''
      // ★ 2026-09-04 多会话截图隔离：文件名带会话短前缀（并发会话同项目截图 ms 级重名会互相覆盖）
      const shotTag = sessionIdOf(exec).slice(0, 8) || 'n'
      if (cwd) {
        const dir = path.join(cwd, 'screenshots')
        fs.mkdirSync(dir, { recursive: true })
        const name = `screenshot-${shotTag}-${Date.now()}.jpg`
        fs.writeFileSync(path.join(dir, name), buf)
        return { ok: true, path: `screenshots/${name}`, size: buf.length, note: '截图已保存到项目 screenshots/ 目录（左侧文件浏览器可查看/下载）' }
      }
      fs.mkdirSync(SHOT_DIR, { recursive: true })
      const name = `shot-${shotTag}-${Date.now()}.jpg`
      fs.writeFileSync(path.join(SHOT_DIR, name), buf)
      return { ok: true, file: name, size: buf.length, note: '截图已生成' }
    },
  }))
  // ── 导航类工具（由 client 泵直接控制 iframe 地址，无需注入脚本）──
  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: '导航内置浏览器到指定 URL（相对路径基于当前预览解析，如 / 或 /path）。★ 不要使用 127.0.0.1/localhost——内置浏览器是服务端代理，这些地址指向服务器内部，用户浏览器无法访问。',
    parameters: { url: { type: 'string', required: true, description: '目标 URL 或相对路径（如 /、/users）' } },
    output: OUTPUT,
    execute: (args: { url: string }, exec) => {
      const u = String(args.url || '').trim()
      // 拒绝 localhost/127.0.0.1：指向服务器内部，用户浏览器连不上 → 明确引导用预览域名/相对路径
      if (/^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(u)) {
        const pu = previewUrlOf(exec)
        return { ok: false, error: `内置浏览器无法打开 127.0.0.1/localhost（指向服务器内部，用户浏览器连不上）。当前项目预览域名：${pu || '（未知）'}——直接用相对路径（如 / 或 /users）或预览域名导航即可。` }
      }
      return runCommand({ type: 'navigate', url: u }, CMD_TIMEOUT, exec?.signal, exec)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'browser_reload',
    description: '重新加载内置浏览器当前页面。',
    parameters: {},
    output: OUTPUT,
    execute: (_args, exec) => runCommand({ type: 'reload' }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_go_back',
    description: '内置浏览器后退到上一页。',
    parameters: {},
    output: OUTPUT,
    execute: (_args, exec) => runCommand({ type: 'back' }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_go_forward',
    description: '内置浏览器前进到下一页。',
    parameters: {},
    output: OUTPUT,
    execute: (_args, exec) => runCommand({ type: 'forward' }, CMD_TIMEOUT, exec?.signal, exec),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_takeover',
    description: '声明 AI 接管浏览器操控（显示"Agent 操控中"边框呼吸指示）。开始操控浏览器前先调用 action=start，所有浏览器操作完成后调用 action=stop 隐藏指示。用户可随时点击"我来接管"暂停。',
    parameters: {
      action: { type: 'string', required: true, description: 'start=开始接管（显示操控指示），stop=结束接管（隐藏指示）' },
      reason: { type: 'string', description: '操控原因（可选，便于用户了解 AI 在做什么）' },
    },
    output: OUTPUT,
    execute: async (args: { action: string; reason?: string }, exec) => {
      const sid = sessionIdOf(exec)
      // 显式接管：直接同步本会话 host 状态（避免 runCommand 的自动接管覆盖）
      if (args.action === 'start') takeoverBySession.set(sid, { active: true, lastActivity: Date.now() })
      else { const st = takeoverBySession.get(sid); if (st) st.active = false }
      const r = await runCommand({ type: 'takeover', action: args.action, reason: args.reason }, CMD_TIMEOUT, exec?.signal, exec) as Record<string, unknown>
      // ★ 开始接管时把当前项目预览域名告诉 AI（每个项目预览有独立 pv-<pid8>.<domain> 域名）
      if (args.action === 'start') {
        const pu = previewUrlOf(exec)
        return { ...r, previewUrl: pu, note: `内置浏览器已就绪。当前项目预览域名：${pu || '（未知）'}——可直接 browser_snapshot 操作，或用相对路径/预览域名导航。` }
      }
      return r
    },
  }))

  // ── 项目预览启停（host 直连 server API，用 SVC_TOKEN 鉴权，不依赖 client 泵）──
  // 项目 ID 省略时从会话 cwd（/app/generated/<uuid>）解析；不触发浏览器接管覆盖层。
  // ★ 改 host 直连：client 泵异常（浏览器页/长轮询断）时工具仍可靠；且 fetch 带 exec.signal，
  //   用户点「停止生成」可立即中断（之前走 client 泵无法取消，停止按钮没反应）。
  const previewTool = (name: 'preview_start' | 'preview_stop', description: string, method: 'previewStart' | 'previewStop') =>
    ctx.tools.register(defineTool({
      name,
      description,
      parameters: { project_id: { type: 'string', description: '项目 ID（省略时用当前会话项目）' } },
      output: OUTPUT,
      execute: async (args: { project_id?: string }, exec) => {
        const pid = String(args?.project_id || '').trim() || projectIdOf(exec)
        if (!pid) return { ok: false, error: '无法确定项目 ID（未指定且当前会话无项目上下文）' }
        const apiBase = process.env.MADAZI_API_BASE || 'http://madazi-server:3456'
        const token = process.env.MADAZI_SVC_TOKEN || ''
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers.Authorization = `Bearer ${token}`
        const signal = exec?.signal as AbortSignal | undefined
        const isReady = (x: Record<string, unknown> | null | undefined): boolean => !!(x && (x.running === true || x.status === 'running' || x.status === 'ready'))
        try {
          const act = method === 'previewStart' ? 'start' : 'stop'
          const r = await fetch(`${apiBase}/api/projects/${pid}/preview/${act}`, { method: 'POST', headers, signal })
          const body = await r.json().catch(() => ({})) as Record<string, unknown>
          if (!r.ok) return { ok: false, error: `预览${act === 'start' ? '启动' : '停止'}失败: ${r.status} ${JSON.stringify(body)}` }
          if (method === 'previewStop') return { ok: true, data: body, pid, note: '预览已停止' }
          // preview_start：轮询 status 直到就绪（最多 180s，可被 signal 中断）
          const pu = previewUrlOf(exec)
          if (isReady(body)) return { ok: true, data: body, pid, previewUrl: pu, note: `预览已就绪：${pu || ''}。请用 browser_navigate 打开 ${pu || '预览域名'}（走内置浏览器同源壳页），不要使用 preview-proxy 内部路径。` }
          const deadline = Date.now() + 180_000
          while (Date.now() < deadline) {
            await new Promise((res) => setTimeout(res, 5000))
            if (signal?.aborted) throw new Error('预览等待被取消（用户停止生成）')
            const s = await fetch(`${apiBase}/api/projects/${pid}/preview/status`, { headers, signal })
            const sj = await s.json().catch(() => ({})) as Record<string, unknown>
            if (isReady(sj)) return { ok: true, data: sj, pid, previewUrl: pu, note: `预览已就绪：${pu || ''}。请用 browser_navigate 打开 ${pu || '预览域名'}。` }
          }
          return { ok: false, error: '等待预览就绪超时（180s），请查看预览日志排查' }
        } catch (e) {
          return { ok: false, error: String((e && (e as Error).message) || e) }
        }
      },
    }))
  previewTool('preview_start',
    '启动当前项目的前端/后端预览（平台预览机制：创建预览 Pod、安装依赖、启动前后端、暴露 pv-* 预览域名）。用户说「运行项目/启动预览/看看效果/把项目跑起来」时优先用它，不要手动 npm install/npm run dev（手动起不暴露预览域名，内置浏览器看不到）。预览冷启动需要时间，返回后未就绪可稍等再用 browser_snapshot 打开验证；已在运行则返回当前状态，重复调用安全。',
    'previewStart')
  previewTool('preview_stop',
    '停止当前项目的预览（回收预览 Pod，释放预览配额）。',
    'previewStop')
}
