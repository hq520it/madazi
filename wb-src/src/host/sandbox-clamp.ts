import { existsSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'

/**
 * 沙箱 clamp：跨项目「按权限读写」（2026-09-05）。
 *
 * 官方语义（漏洞根源）：
 *   · danger-full-access 时 terminal-bash spawnArgv 直接裸跑（不进 Landlock），
 *     fs-sandbox checkedTarget 也原样放行 —— 容器 root 一路全盘可写；
 *   · 读操作全档位透传（fs-sandbox 设计如此），Landlock readOnly: '/' 全盘可读。
 *
 * 平台目标：一个会话里，写 = 本项目（workspace-write 档）或「创建人有权限的
 * 所有项目」（danger-full-access 档，重定义而非删除）；读 = 有权限的项目集合；
 * 无权限项目读写全拒。会话→用户来自平台 dsh_session_owners（cookie 鉴权上报，
 * 先到先得不可伪造），权限根列表由 madazi-server 全量下发（30s 轮询）。
 *
 * 实现（全部官方扩展点，实例方法遮蔽，与 session-ref-archive 同手法）：
 *   1. wrap sandboxPolicy.resolve —— 执行时刻唯一 mode 权威出口：danger-full-access
 *      压成 workspace-write（同时堵 bash 裸跑与 fs 放行两条官方分支），并附加
 *      __madaziReadRoots / __madaziWriteRoots（运行时附加属性，不改官方类型）；
 *   2. wrap sandbox.confine —— Landlock runner 的 grant 段重建为多 ro（有权限
 *      项目 + 系统目录）/ 多 rw（写根集合）；非 landlock 环境保持官方单根；
 *   3. wrap ctx.fs.writeText/editText —— target 匹配写根时构造 per-call policy
 *      （复用官方 containment 与 TOCTOU 防护），越界抛 FS_SANDBOX_DENIED；
 *   4. wrap ctx.fs.resolve —— 读边界校验（fs 读方法本身无会话上下文，但读工具
 *      链路统一经 resolve(path, {cwd: session cwd})——用 cwd 反查会话读根交集；
 *      无 cwd 的 agentless/UI 调用放行）。
 *
 * fail-closed：未登记归属（新会话 30s 窗口内 / 平台不可达）→ 无附加根，
 * 退回官方单 workspace 根语义 —— 宁可少权限，不多给。
 */

/** 官方策略对象的最小结构面（运行时附加 __madazi* 属性）。 */
interface Policy {
  mode: string
  workspaceRoot: string
  sessionId?: string
  __madaziReadRoots?: string[]
  __madaziWriteRoots?: string[]
}

interface ConfinedArgv {
  argv: string[]
  enforcement?: string
  denialSignatures?: readonly string[]
  runnerFailureRules?: unknown[]
}

/** 写面 = /dev/null + (非只读) /tmp + 有权限项目根；读面 = 系统白名单 + 有权限项目根。 */
const RUNTIME_RW = ['/dev/null', '/tmp']

/**
 * bash 运行所需的系统只读面（read+execute）。Landlock readOnly 不给全盘 '/'
 * （否则能读所有项目 + /root + /etc 等系统敏感目录，超出「只能读有权限项目」预期）。
 * ★ 不列 /root /home /srv：敏感目录（用户家目录/服务器数据）不给读——bash 没有它们
 * 也能正常跑（HOME 配置读不到非致命）。重建 grant 时全部过 existsSync：
 * 不存在的路径（如 arm64 无 /lib64）直接跳过，否则 launcher「cannot open rule path」
 * exit 125 → bash 全挂（2026-09-05 两次踩坑）。
 */
const SYSTEM_READ = [
  '/usr', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/local',
  '/bin', '/sbin', '/lib', '/etc', '/opt', '/var', '/run',
  '/dev', '/proc', '/sys', '/tmp',
]

const dedupe = (xs: readonly string[]): string[] => [...new Set(xs)]

/** 会话 → 有权限项目根（模块级共享：sandbox-clamp 维护，@会话候选过滤复用）。
 * 不挂 ctx（cordis ctx.set 需先 provide，直接 set 抛异常导致插件加载崩溃——2026-09-05）。 */
export const madaziAccessMap = new Map<string, string[]>()

/** path 是否位于 root 之内（root 本身或其子路径）。 */
const under = (root: string, path: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : root + '/')

/** target 可能是 FsTarget 对象（displayPath）或纯字符串。 */
const displayPath = (t: unknown): string => {
  if (typeof t === 'string') return t
  const p = (t as { displayPath?: unknown } | null)?.displayPath
  return typeof p === 'string' ? p : ''
}

export function registerSandboxClamp(ctx: Context): () => void {
  const policySvc = ctx.get('sandboxPolicy') as { resolve: (req?: { session?: { id?: string }; mode?: string }) => Policy } | undefined
  const sandbox = ctx.get('sandbox') as { confine: (argv: readonly string[], policy: Policy) => ConfinedArgv } | undefined
  const fs = ctx.get('fs') as Record<string, unknown> | undefined
  if (policySvc === undefined || sandbox === undefined || fs === undefined) {
    // ★ 诊断（2026-09-05）：曾静默跳过导致 clamp 从未生效却无日志
    console.warn('[sandbox-clamp] 服务未就绪，clamp 未启用', {
      policySvc: policySvc === undefined,
      sandbox: sandbox === undefined,
      fs: fs === undefined,
    })
    return () => {}
  }
  console.log('[sandbox-clamp] 已注册（policySvc/sandbox/fs 全部就绪）')

  // ── 会话 → 有权限项目根（SSE 推送 + 事件 + 按需，无定时器）──
  // 主路径 = server 推送：会话归属/权限变更 → SSE changed → 全量重拉（撤销/授权秒级）；
  // 辅助 = session/created 事件刷新 + resolve 未命中按需补拉（事件丢失自愈）；
  // 断线 = 指数退避重连，重连成功立即全量重同步（server 连接即发初始信号，双保险）。
  const base = process.env.MADAZI_SERVER_URL || 'http://madazi-server:3456'
  const token = process.env.MADAZI_INTERNAL_TOKEN || ''
  let refreshing = false
  let lastRefresh = 0
  const REFRESH_MIN_INTERVAL = 5000 // 并发触发防抖：同一秒内多次信号只拉一次
  const refresh = async (): Promise<void> => {
    if (refreshing || token === '') return
    refreshing = true
    try {
      const r = await fetch(base + '/api/dsh/session-access-map', { headers: { 'x-madazi-internal': token } })
      if (r.ok) {
        const j = (await r.json()) as Record<string, { roots?: string[] }>
        const next = new Map<string, string[]>()
        for (const [sid, v] of Object.entries(j)) if (Array.isArray(v?.roots)) next.set(sid, v.roots.filter((x) => typeof x === 'string'))
        madaziAccessMap.clear()
        for (const [k, v] of next) madaziAccessMap.set(k, v)
      }
      lastRefresh = Date.now()
    } catch { /* 平台不可达：保持旧 map（fail-closed 到单根） */ } finally { refreshing = false }
  }
  const refreshSoon = (): void => {
    if (Date.now() - lastRefresh < REFRESH_MIN_INTERVAL) return
    void refresh()
  }
  void refresh() // 启动即同步一次（兜底：SSE 尚未建立时也有数据）

  // SSE 客户端：订阅变更信号；断线指数退避重连（1s→30s 封顶），重连即全量重同步
  let sseRetry = 1000
  let sseAbort: AbortController | null = null
  let sseClosed = false
  const connectSSE = async (): Promise<void> => {
    if (sseClosed || token === '') return
    sseAbort = new AbortController()
    try {
      const r = await fetch(base + '/api/dsh/access-map/events', { headers: { 'x-madazi-internal': token }, signal: sseAbort.signal })
      if (!r.ok || r.body === null) throw new Error(`SSE HTTP ${r.status}`)
      sseRetry = 1000 // 连接成功 → 重置退避
      await refresh() // 连接建立即全量重同步
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          if (frame.includes('event: changed')) refreshSoon()
        }
      }
    } catch { /* 断线/中止：走重连 */ }
    if (sseClosed) return
    setTimeout(() => { void connectSSE() }, sseRetry)
    sseRetry = Math.min(sseRetry * 2, 30000)
  }
  void connectSSE()

  const offCreated = ctx.on('session/created', () => refreshSoon()) as unknown as () => void

  /**
   * cwd → 该 cwd 项目下所有已知会话的读根交集（∪ cwd 本身）。
   * fs 读链路只带 cwd（sessionResolveOptions 无会话身份），用 cwd 反查：
   * 同项目多会话取交集 = 保守且正确（权限不放大；多会话同 cwd 时任何一方
   * 无权限的项目都读不到）。无任何匹配会话 → 仅 cwd（fail-closed）。
   */
  const readRootsForCwd = (cwd: string): string[] => {
    let allowed: string[] | null = null
    for (const roots of madaziAccessMap.values()) {
      if (!roots.some((r) => under(r, cwd))) continue
      allowed = allowed === null ? [...roots] : allowed.filter((r) => roots.includes(r))
    }
    return allowed === null ? [cwd] : dedupe([cwd, ...allowed])
  }

  // ── 1. resolve：mode clamp + 附加权限根 ──────────────────────────
  let dangerLogShown = false
  const origResolve = policySvc.resolve.bind(policySvc)
  policySvc.resolve = (request = {}) => {
    const p = origResolve(request)
    try {
      const sid = request?.session?.id ?? p.sessionId
      const roots = sid != null ? madaziAccessMap.get(sid) : undefined
      if (sid != null && roots === undefined) refreshSoon() // 未命中 → 按需补拉（事件丢失自愈）
      // ★ 诊断（2026-09-05）：确认 danger 压级路径被真实调用
      if (p.mode === 'danger-full-access' && !dangerLogShown) {
        dangerLogShown = true
        console.log('[sandbox-clamp] danger-full-access 命中压级', { sid, roots: roots?.length ?? 0, workspaceRoot: p.workspaceRoot })
      }
      // danger-full-access → 压成 workspace-write（多根语义在 __madaziWriteRoots 表达）。
      // 同时堵两条官方放行分支：terminal-bash spawnArgv 裸跑、fs checkedTarget 原样放行。
      const mode = p.mode === 'danger-full-access' ? 'workspace-write' : p.mode
      const readRoots = dedupe([p.workspaceRoot, ...(roots ?? [])])
      const writeRoots = mode === 'read-only' ? [] : p.mode === 'danger-full-access' && roots ? dedupe([p.workspaceRoot, ...roots]) : [p.workspaceRoot]
      const clamped = { ...p, mode } as Policy
      clamped.__madaziReadRoots = readRoots
      clamped.__madaziWriteRoots = writeRoots
      return clamped
    } catch {
      // ★ fail-closed（2026-09-05 review）：wrap 内部异常也绝不放开——
      // danger 压成 workspace-write 单根，其余保留原档位单根。宁可少权限。
      const mode = p.mode === 'danger-full-access' ? 'workspace-write' : p.mode
      const clamped = { ...p, mode } as Policy
      clamped.__madaziReadRoots = [p.workspaceRoot]
      clamped.__madaziWriteRoots = mode === 'read-only' ? [] : [p.workspaceRoot]
      return clamped
    }
  }

  // ── 2. confine：重建 grant——读面 = 系统白名单 + 有权限项目根；写面 = 有权限项目根 ──
  // 所有模式生效（不止 danger 压级）：bash 也遵守「只能读系统 + 有权限项目」边界，
  // 无权限项目根不在读面 → 读不到。官方 readOnly: ['/'] 全盘可读超出该预期，不采用。
  // 重建的两个关键护栏（2026-09-05 两次踩坑）：
  //   1) 白名单含不存在的路径（arm64 无 /lib64）→ launcher exit 125 → bash 全挂；
  //   2) 权限根可能含幽灵路径（项目已删但 DB source_path 仍在，如 30527f8f…）。
  //      统一 existsSync 过滤：不存在路径不进 grant 列表。
  // bwrap：容器 userns 禁用时不可用（防御性）；读面保持官方 --ro-bind / /，仅扩写根。
  const origConfine = sandbox.confine.bind(sandbox)
  sandbox.confine = (argv, policy) => {
    const write = policy.__madaziWriteRoots ?? []
    const read = policy.__madaziReadRoots
    const confined = origConfine(argv, policy)
    try {
      const a = confined.argv
      const liveWrite = write.filter((w) => existsSync(w))
      const liveRead = read === undefined ? [] : dedupe([...SYSTEM_READ, ...read]).filter((r) => existsSync(r))
      if (a[0] && String(a[0]).endsWith('landlock-run')) {
        const sep = a.indexOf('--')
        if (sep < 0) return confined
        const cmd = a.slice(sep + 1)
        const ro = liveRead.length > 0 ? liveRead : ['/'] // 兜底：读面意外为空则全盘只读（不该发生）
        const rw = [RUNTIME_RW[0]] // /dev/null
        if (policy.mode !== 'read-only') rw.push(RUNTIME_RW[1]) // /tmp
        for (const w of liveWrite) rw.push(w)
        return { ...confined, argv: [a[0], ...ro.flatMap((r) => ['--ro', r]), ...rw.flatMap((r) => ['--rw', r]), '--', ...cmd] }
      }
      if (a[0] === 'bwrap') {
        const out: string[] = []
        for (let i = 0; i < a.length; i++) {
          if (a[i] === '--bind' && i + 2 < a.length && a[i + 1] === a[i + 2]) {
            for (const w of liveWrite) out.push('--bind', w, w)
            i += 2
          } else out.push(a[i])
        }
        return { ...confined, argv: out }
      }
      return confined
    } catch {
      return confined
    }
  }

  // ── 3. fs 写：按 target 匹配写根，构造 per-call policy（复用官方 containment）──
  const wrapWrite = (name: 'writeText' | 'editText'): void => {
    const orig = fs[name] as (...args: never[]) => Promise<unknown>
    const bound = orig.bind(fs)
    fs[name] = ((target: unknown, ...rest: never[]) => {
      const policy = (rest.length > 3 ? rest[3] : undefined) as Policy | undefined
      const roots = policy?.__madaziWriteRoots
      if (roots === undefined) {
        // ★ fail-closed（2026-09-05 review）：policy 无附加根（理论不可达，resolve 必附加）——
        // 单根兜底不多给：保留 read-only，其余按 workspace-write 单根。
        const mode = policy?.mode === 'read-only' ? 'read-only' : 'workspace-write'
        const patched = { ...policy, mode, workspaceRoot: policy?.workspaceRoot ?? '' } as Policy
        return bound(target, rest[0], rest[1], rest[2], patched as never)
      }
      if (roots.length <= 1) return bound(target, ...rest)
      const path = displayPath(target)
      const match = roots.find((r) => under(r, path))
      if (match === undefined) {
        throw new FsError(`cannot write "${path}": file access denied outside permitted project roots`, 'FS_SANDBOX_DENIED')
      }
      // 本项目根走原 policy；跨项目权限根替换 workspaceRoot（官方 containment 复检）
      const patched = match === policy.workspaceRoot ? policy : { ...policy, mode: 'workspace-write', workspaceRoot: match }
      return bound(target, rest[0], rest[1], rest[2], patched as never)
    }) as typeof orig
  }
  wrapWrite('writeText')
  wrapWrite('editText')

  // ── 4. fs.resolve：读边界（读工具链路统一入口；带 cwd 的 agent 调用校验）──
  const origFsResolve = fs.resolve as (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => Promise<unknown>
  const resolveBound = origFsResolve.bind(fs)
  fs.resolve = ((path: string, opts?: { cwd?: string; signal?: AbortSignal }) => {
    const cwd = opts?.cwd
    if (typeof path === 'string' && cwd !== undefined) {
      const abs = isAbsolute(path) ? path : resolvePath(cwd, path)
      const allowed = readRootsForCwd(cwd)
      if (!allowed.some((r) => under(r, abs))) {
        throw new FsError(`cannot read "${abs}": not found`, 'FS_NOT_FOUND')
      }
    }
    return resolveBound(path, opts)
  }) as typeof origFsResolve

  return () => {
    sseClosed = true
    sseAbort?.abort()
    offCreated()
    policySvc.resolve = origResolve
    sandbox.confine = origConfine
    // fs wrap 不逐一还原：dispose 只发生在插件卸载（进程生命周期一致）
  }
}
