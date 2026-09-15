import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BROWSER_DUMP_EVAL } from '../../shared/browser-dump-eval.ts'
import { BROWSER_MSG_SOURCE } from '../../shared/browser-msg.ts'
import { normalizeBrowserElSnapshot, type BrowserElSnapshot } from '../../shared/browser-el.ts'
import { browserViewSrc, isWorkbenchSelfUrl, normalizeBrowserUrl } from '../../shared/browser-url.ts'
import { IconButton } from './IconButton.tsx'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDevtools,
  IconInspect,
  IconRefresh,
  IconSparkle,
} from './icons.tsx'
import {
  canBrowserBack,
  canBrowserForward,
  commitBrowserUrl,
  ensureBrowserTab,
  goBrowserHistory,
  patchBrowserTab,
  pushBrowserConsole,
  clearBrowserConsole,
  beginBrowserLoad,
  consumeBrowserProbe,
  readBrowserTab,
  setBrowserApp,
  setBrowserCss,
  setBrowserFiles,
  subscribeBrowserSession,
  upsertBrowserNetwork,
  type BrowserConsoleLine,
} from './browser-session.ts'
import type { Translate } from './types.ts'
import css from './BrowserView.module.css'

// ── fork 定制：madazi 预览控制（S6 源码化，替代 hello 插件 DOM hack）──
type PvProj = { id: string; name: string; status?: string }
const PV_HIS_KEY = 'madazi.previewHistory'

function pvUrlFor(pid: string): string {
  const h = (typeof location !== 'undefined' && location.host || '').split('.').slice(1).join('.')
  return h ? `https://pv-${String(pid).slice(0, 8)}.${h}/` : ''
}

function projId8OfUrl(url: string): string | null {
  const u = String(url || '')
  let m = u.match(/\/\/pv-([0-9a-fA-F]{8})\./)
  if (!m) {
    // iframe src 是 /git/browser/view?u=...（pv 地址被 URL 编码）→ 解码后再匹配
    try {
      const d = decodeURIComponent(u)
      m = d.match(/\/\/pv-([0-9a-fA-F]{8})\./)
    } catch { /* ignore */ }
  }
  return m ? m[1].toLowerCase() : null
}

function pvHisGet(): Array<{ url: string; t: number }> {
  try {
    return JSON.parse(localStorage.getItem(PV_HIS_KEY) || '[]') as Array<{ url: string; t: number }>
  } catch {
    return []
  }
}

function pvHisAdd(url: string): void {
  if (!url || !/^https?:\/\//.test(url)) return
  const norm = url.replace(/\/+$/, '') + '/'
  const list = pvHisGet().filter(x => x.url !== norm)
  list.unshift({ url: norm, t: Date.now() })
  try { localStorage.setItem(PV_HIS_KEY, JSON.stringify(list.slice(0, 10))) } catch { /* ignore */ }
}

function pvSvc(): { [k: string]: any } | null {
  return (window as unknown as { __madaziSvc?: { [k: string]: any } }).__madaziSvc || null
}

// ★ fork：项目列表优先走浏览器同源 cookie 直连 /api/projects（平台家族 traefik 直达 server）。
//   RPC listProjects 走 node 半 SVC_TOKEN——token 缺失/24h 过期即 401，且失败被静默吞掉，
//   归档项目因此永远滤不掉（下拉残留根因）。直连失败才回退 RPC。
async function pvListProjects(): Promise<PvProj[]> {
  try {
    const r = await fetch('/api/projects', { credentials: 'same-origin' })
    const j: unknown = await r.json().catch(() => null)
    if (r.ok && Array.isArray(j)) {
      const all = j as PvProj[]
      return all.filter(p => p.status !== 'archived')
    }
  } catch { /* 回退 RPC */ }
  const s = pvSvc()
  if (!s || typeof s.listProjects !== 'function') throw new Error('listProjects unavailable')
  const l = await s.listProjects()
  const arr = l && l.ok ? (Array.isArray(l.value) ? l.value : []) : (Array.isArray(l) ? l : [])
  return (arr as PvProj[]).filter(p => p.status !== 'archived')
}

// 用一份确定的项目列表清理 localStorage 历史里的归档/已删项目残留
function pvPruneHistory(list: PvProj[]): void {
  const live8 = new Set(list.map(p => String(p.id).slice(0, 8).toLowerCase()))
  const all = pvHisGet()
  const his = all.filter(x => {
    const pid8 = projId8OfUrl(x.url)
    return pid8 == null || live8.has(pid8)
  })
  if (his.length < all.length) {
    console.log('[madazi-log] pv history pruned (deleted projects):', all.length - his.length)
    try { localStorage.setItem(PV_HIS_KEY, JSON.stringify(his)) } catch { /* ignore */ }
  }
}

export function BrowserView({
  tabId,
  onTitle,
  onOpenDevtools,
  onPick,
  t,
}: {
  tabId: string
  onTitle: (title: string, url: string) => void
  onOpenDevtools: () => void
  onPick: (snapshot: BrowserElSnapshot) => boolean
  t: Translate
}) {
  const state = useSyncExternalStore(
    subscribeBrowserSession,
    () => readBrowserTab(tabId),
    () => readBrowserTab(tabId),
  )
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [invalid, setInvalid] = useState(false)
  // ── fork 定制：madazi 预览控制 ──
  const [pvOpen, setPvOpen] = useState(false)
  const [pvCtlOpen, setPvCtlOpen] = useState(false)
  const [pvList, setPvList] = useState<PvProj[]>([])
  const [pvLoaded, setPvLoaded] = useState(false)
  const [pvBusy, setPvBusy] = useState(false)
  const [pvRunning, setPvRunning] = useState(false)
  const [pvMenuStatus, setPvMenuStatus] = useState<Record<string, boolean>>({})
  const pvProjRef = useRef<PvProj | null>(null)
  // ★ 2026-09-04 死循环修复：refreshPv 曾把 pvList 放进 useCallback 依赖又在内部
  //   setPvList(新数组引用) → 依赖每次变 → useEffect 无限重跑 → previewStatus 疯狂轮询
  //   （实测 22 次/秒），页面被请求风暴拖卡、AI 浏览器操作拿不到 iframe → 「打开预览没反应」。
  //   项目列表改存 ref：渲染仍用 state（pvMergedRows/pv 下拉），refreshPv 只依赖 committed。
  const pvListRef = useRef<PvProj[]>([])

  const refreshPv = useCallback((): void => {
    const pid8 = projId8OfUrl(state.committed)
    const s = pvSvc()
    if (!pid8 || !s) {
      pvProjRef.current = null
      setPvRunning(false)
      return
    }
    const load = (list: PvProj[]): void => {
      const proj = list.find(p => String(p.id).slice(0, 8).toLowerCase() === pid8) || null
      pvProjRef.current = proj
      if (!proj) { setPvRunning(false); return }
      s.previewStatus(proj.id).then((d: any) => {
        const v = d && d.ok ? d.value : d
        setPvRunning(!!(v && (v.running || v.status === 'running')))
      }).catch(() => { setPvRunning(false) })
    }
    // ★ 不缓存项目列表：归档后打开下拉必须看到最新存活项目（缓存会让归档项目残留）
    pvListProjects().then((arr) => {
      setPvList(arr)
      pvListRef.current = arr
      setPvLoaded(true)
      pvPruneHistory(arr)
      load(arr)
    }).catch(() => {
      // ★ 拉取失败也用最后一次成功列表继续过滤/清理历史，
      //   否则归档项目从 localStorage 历史里残留（下拉显示一堆测试导入）
      if (pvListRef.current.length > 0) pvPruneHistory(pvListRef.current)
      pvProjRef.current = null
      setPvRunning(false)
    })
  }, [state.committed])

  useEffect(() => { refreshPv() }, [refreshPv])

  // ★ fork：预览未运行 → 启动按钮（listProjects 拿完整 id → previewStart → 轮询等 running）
  const startPv = useCallback((): void => {
    const proj = pvProjRef.current
    const s = pvSvc()
    if (!proj || !s || typeof s.previewStart !== 'function' || pvBusy) return
    setPvBusy(true)
    s.previewStart(proj.id)
      .then(() => {
        const poll = (n: number): void => {
          if (n <= 0) { setPvBusy(false); refreshPv(); return }
          window.setTimeout(() => {
            s.previewStatus(proj.id).then((x: any) => {
              const v = x && x.ok ? x.value : x
              if (v && (v.running || v.status === 'running')) { setPvBusy(false); refreshPv() }
              else poll(n - 1)
            }).catch(() => { setPvBusy(false); refreshPv() })
          }, 3000)
        }
        poll(30) // 最长 90s
      })
      .catch(() => { setPvBusy(false) })
  }, [pvBusy, refreshPv])

  const pvMergedRows = (): Array<{ url: string; name: string | null; pid: string | null }> => {
    const h = pvHisGet()
    const out: Array<{ url: string; name: string | null; pid: string | null }> = []
    const seen: Record<string, number> = {}
    for (const x of h) {
      if (seen[x.url]) continue
      seen[x.url] = 1
      // ★ fork：列表成功拉取过（非空）后，历史里的 pv-* 条目必须对应现存项目——
      //   归档/已删项目从下拉剔除。不依赖 pvLoaded：拉取失败也用上一次列表过滤，
      //   否则 pvLoaded=false 时归档项目全量残留（下拉显示一堆测试导入）。
      if (pvList.length > 0) {
        const pid8 = projId8OfUrl(x.url)
        if (pid8 && !pvList.some(p => String(p.id).slice(0, 8).toLowerCase() === pid8)) continue
      }
      out.push({ url: x.url, name: null, pid: null })
    }
    for (const p of pvList) {
      const url = pvUrlFor(p.id)
      if (url && !seen[url]) { seen[url] = 1; out.push({ url, name: p.name, pid: p.id }) }
    }
    return out.map(m => {
      if (m.pid) return m
      const pid8 = projId8OfUrl(m.url)
      const pp = pid8 ? pvList.find(p => String(p.id).slice(0, 8).toLowerCase() === pid8) : undefined
      return pp ? { url: m.url, name: pp.name, pid: pp.id } : m
    })
  }

  useEffect(() => {
    if (!pvOpen) return
    const s = pvSvc()
    const rows = pvMergedRows()
    const withPid = rows.filter(r => r.pid)
    if (!s || !withPid.length) { setPvMenuStatus({}); return }
    const out: Record<string, boolean> = {}
    let alive = true
    Promise.all(withPid.map(r => s.previewStatus(r.pid).then((d: any) => {
      const v = d && d.ok ? d.value : d
      out[r.url] = !!(v && (v.running || v.status === 'running'))
    }).catch(() => {}))).then(() => { if (alive) setPvMenuStatus(out) })
    return () => { alive = false }
  }, [pvOpen, pvList])
  const inspectRef = useRef(state.inspect)
  inspectRef.current = state.inspect
  const evalWaitRef = useRef<{ nonce: number; timer: number } | null>(null)
  const seenEvalRef = useRef<number | null>(null)
  const silentEvalRef = useRef(new Set<number>())
  const dumpNonceRef = useRef(1_000_000_000)
  const dumpTimerRef = useRef(0)
  const src = state.committed === '' ? '' : browserViewSrc(state.committed)

  // ★ fork：选择未运行项目 → 自动启动（最多自动 3 次，失败后降级为手动按钮）
  //   切换项目时 reset 计数器，否则累计 3 次后永远不自动启动（即使网络恢复）
  const pvFailRef = useRef(0)
  const pvFailPidRef = useRef(null)
  useEffect(() => {
    const pid8 = projId8OfUrl(src)
    if (pid8 !== pvFailPidRef.current) { pvFailRef.current = 0; pvFailPidRef.current = pid8 }
    if (pvRunning === false && pid8 !== null && !pvBusy && pvProjRef.current) {
      if (pvFailRef.current < 3) { pvFailRef.current++; startPv() }
    }
  }, [pvRunning, pvBusy, src, startPv])
  const showEmpty = state.committed === ''

  // ★ fork：AI 修复兜底入口 —— 预览没正常显示时，抓日志尾部 + 当前地址/运行状态，
  //   经插件桥（window.__madaziLogFix）发到该项目会话；纯手动触发，不自动弹不烧 token
  const [pvFixSending, setPvFixSending] = useState(false)
  const aiFixPv = async (): Promise<void> => {
    const proj = pvProjRef.current
    const fn = (window as unknown as { __madaziLogFix?: (p: string, l: string[], h?: string) => boolean }).__madaziLogFix
    if (!proj) { setFlash({ kind: 'err', text: '当前地址不是项目预览，先从下拉选择项目' }); return }
    if (typeof fn !== 'function') { setFlash({ kind: 'err', text: 'AI 修复通道未就绪（插件未加载）' }); return }
    setPvFixSending(true)
    let lines: string[] = []
    try {
      const r = await fetch(`/api/projects/${proj.id}/logs?type=startup`, { credentials: 'same-origin' })
      const j: unknown = await r.json().catch(() => null)
      const logs = j !== null && typeof j === 'object' && typeof (j as { logs?: unknown }).logs === 'string'
        ? (j as { logs: string }).logs : ''
      lines = logs.split('\n').slice(-150)
    } catch { /* 日志拉不到也发（hint 里有上下文） */ }
    const ok = fn(proj.id, lines, `内置浏览器预览未正常显示。当前地址: ${src || '(空)'}；预览运行状态: ${pvRunning === true ? 'running' : pvRunning === false ? 'not-running' : 'unknown'}；请检查 .preview-config.json（install_cmd/start_cmd/workdir）或代码问题，修好后可让用户重启预览`)
    setFlash(ok !== false
      ? { kind: 'ok', text: '已把日志发给 AI，请到对话中查看修复进展' }
      : { kind: 'err', text: '发送失败：未找到该项目的工作区/会话' })
    setPvFixSending(false)
  }

  useEffect(() => {
    ensureBrowserTab(tabId)
    return () => { window.clearTimeout(dumpTimerRef.current) }
  }, [tabId])

  useEffect(() => {
    if (flash === null) return
    const id = window.setTimeout(() => { setFlash(null) }, 4000)
    return () => { window.clearTimeout(id) }
  }, [flash])

  const postInspect = (on: boolean): void => {
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    win.postMessage({ source: BROWSER_MSG_SOURCE, type: 'inspect', on }, '*')
  }

  const sendPageDump = (): void => {
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    dumpNonceRef.current += 1
    const id = dumpNonceRef.current
    silentEvalRef.current.add(id)
    win.postMessage({ source: BROWSER_MSG_SOURCE, type: 'eval', id, code: BROWSER_DUMP_EVAL }, '*')
  }

  const schedulePageDump = (): void => {
    window.clearTimeout(dumpTimerRef.current)
    dumpTimerRef.current = window.setTimeout(() => { sendPageDump() }, 250)
  }

  useEffect(() => {
    if (!state.inspect) {
      postInspect(false)
      return
    }
    postInspect(true)
    let n = 0
    const id = window.setInterval(() => {
      n += 1
      postInspect(true)
      if (n >= 12) window.clearInterval(id)
    }, 250)
    return () => { window.clearInterval(id) }
  }, [state.inspect, src])

  useEffect(() => {
    const req = state.evalRequest
    if (req === null) return
    if (seenEvalRef.current === req.nonce) return
    seenEvalRef.current = req.nonce
    patchBrowserTab(tabId, { evalRequest: null })
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) {
      pushBrowserConsole(tabId, 'error', t('browser.info.consoleEvalNoFrame'), 'result')
      return
    }
    win.postMessage({ source: BROWSER_MSG_SOURCE, type: 'eval', id: req.nonce, code: req.code }, '*')
    if (evalWaitRef.current !== null) window.clearTimeout(evalWaitRef.current.timer)
    const timer = window.setTimeout(() => {
      if (evalWaitRef.current?.nonce !== req.nonce) return
      evalWaitRef.current = null
      pushBrowserConsole(tabId, 'error', t('browser.info.consoleTimeout'), 'result')
    }, 4000)
    evalWaitRef.current = { nonce: req.nonce, timer }
  }, [state.evalRequest, t, tabId])

  useEffect(() => {
    const req = state.probeRequest
    if (req === null) return
    if (!consumeBrowserProbe(tabId, req.nonce)) return
    const win = frameRef.current?.contentWindow
    if (win === null || win === undefined) return
    win.postMessage({ source: BROWSER_MSG_SOURCE, type: 'probe' }, '*')
    schedulePageDump()
  }, [state.probeRequest, tabId])

  useEffect(() => {
    // ★ 地址栏跟随页面真实地址：注入脚本上报的 url（基于 base.href 生成的真实预览 URL，
    //   含 hash/pathname）与地址栏同源时，仅更新地址栏显示（input）。
    //   ⚠️ 不能动 committed：committed 驱动 iframe src（browserViewSrc(committed)），
    //   更新它会重载预览、丢失 SPA 内部 hash 路由（跳回首页）。
    const syncAddressFromPage = (url: string): void => {
      if (typeof url !== 'string' || url === '') return
      const cur = state.committed
      if (cur === '' || cur === url) return
      try {
        const a = new URL(url)
        const b = new URL(cur)
        if (a.origin !== b.origin) return // 跨源（代理/外部）不接管，交 navigate
        patchBrowserTab(tabId, { input: url })
      } catch { /* ignore */ }
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as Record<string, unknown> | null
      if (data === null || typeof data !== 'object' || data.source !== BROWSER_MSG_SOURCE) return
      const type = data.type
      if (type === 'ready' || type === 'page') {
        const url = typeof data.url === 'string' ? data.url : state.committed
        const title = typeof data.title === 'string' ? data.title : ''
        const ua = typeof data.ua === 'string' ? data.ua : ''
        const viewportRaw = data.viewport
        const viewport = viewportRaw !== null && typeof viewportRaw === 'object'
          ? {
            w: Number((viewportRaw as { w?: unknown }).w) || 0,
            h: Number((viewportRaw as { h?: unknown }).h) || 0,
          }
          : { w: 0, h: 0 }
        patchBrowserTab(tabId, {
          status: 'ok',
          title,
          page: {
            url,
            title,
            ua,
            viewport,
            secure: data.secure === true,
            cookiesEnabled: data.cookiesEnabled !== false,
          },
        })
        // ★ 地址栏跟随页面真实地址（含 hash/pathname；只改显示，不导航、不推历史）
        syncAddressFromPage(url)
        onTitle(title, url)
        if (inspectRef.current) postInspect(true)
        schedulePageDump()
        return
      }
      if (type === 'fail') {
        const message = typeof data.message === 'string' ? data.message : t('browser.fail')
        const hint = typeof data.hint === 'string' ? data.hint : t('browser.failHint')
        patchBrowserTab(tabId, { status: 'fail', failMessage: message, failHint: hint })
        return
      }
      if (type === 'nav' && typeof data.url === 'string') {
        navigate(data.url)
        return
      }
      if (type === 'console' && typeof data.text === 'string') {
        const level = data.level === 'warn' || data.level === 'error' || data.level === 'info'
          ? data.level
          : 'log'
        pushBrowserConsole(tabId, level as BrowserConsoleLine['level'], data.text)
        return
      }
      if (type === 'console-clear') {
        clearBrowserConsole(tabId)
        return
      }
      if (type === 'eval-result') {
        const nonce = Number(data.id)
        if (evalWaitRef.current !== null && evalWaitRef.current.nonce === nonce) {
          window.clearTimeout(evalWaitRef.current.timer)
          evalWaitRef.current = null
        }
        if (silentEvalRef.current.has(nonce)) {
          silentEvalRef.current.delete(nonce)
          return
        }
        const ok = data.ok !== false
        const text = typeof data.text === 'string' ? data.text : (ok ? 'undefined' : t('browser.info.consoleEvalFailed'))
        pushBrowserConsole(tabId, ok ? 'log' : 'error', text, 'result')
        return
      }
      if (type === 'net') {
        upsertBrowserNetwork(tabId, data.entries ?? data.entry)
        return
      }
      if (type === 'app') {
        setBrowserApp(tabId, data)
        return
      }
      if (type === 'css') {
        setBrowserCss(tabId, data)
        return
      }
      if (type === 'files') {
        setBrowserFiles(tabId, data.files)
        return
      }
      if (type === 'pick') {
        const snapshot = normalizeBrowserElSnapshot(data.snapshot)
        if (snapshot === null) {
          setFlash({ kind: 'err', text: t('browser.el.failed') })
          return
        }
        const ok = onPick(snapshot)
        setFlash({
          kind: ok ? 'ok' : 'err',
          text: ok ? t('browser.el.inserted', { tag: snapshot.tag }) : t('browser.el.failed'),
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [onPick, onTitle, state.committed, t, tabId])

  const navigate = (raw: string): void => {
    let input = raw.trim()
    if (input === '') {
      setInvalid(true)
      patchBrowserTab(tabId, { failMessage: t('browser.badUrl'), failHint: t('browser.badUrlHint') })
      return
    }
    // ★ 纯 hash 输入（如 #/system/users）→ 应用到当前预览地址，做同源 hash 切换
    if (input.startsWith('#')) {
      const cur = state.committed
      if (cur && /^https?:/.test(cur)) input = cur.split('#')[0] + input
    }
    const url = normalizeBrowserUrl(input)
    if (url === null) {
      setInvalid(true)
      patchBrowserTab(tabId, { failMessage: t('browser.badUrl'), failHint: t('browser.badUrlHint') })
      return
    }
    if (typeof location !== 'undefined' && isWorkbenchSelfUrl(url, location.href)) {
      setInvalid(true)
      patchBrowserTab(tabId, {
        failMessage: t('browser.self'),
        failHint: t('browser.selfHint'),
        status: 'fail',
      })
      return
    }
    // ★ 与当前预览同源、仅 hash 不同 → 发 set-hash 给 iframe（SPA 自己切路由），
    //   不导航、不重载（否则服务端 fetch 丢 hash 回首页）
    const cur = state.committed
    if (cur) {
      try {
        const a = new URL(url)
        const b = new URL(cur)
        if (a.origin === b.origin && a.pathname === b.pathname && a.hash !== b.hash) {
          setInvalid(false)
          const frame = frameRef.current
          if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage(
              { source: BROWSER_MSG_SOURCE, type: 'set-hash', hash: a.hash },
              '*',
            )
          }
          return
        }
      } catch { /* ignore */ }
    }
    setInvalid(false)
    commitBrowserUrl(tabId, url)
    onTitle('', url)
  }

  const submitAddress = (): void => {
    navigate(state.input)
  }

  const togglePvAct = (): void => {
    const s = pvSvc()
    const proj = pvProjRef.current
    if (!s || !proj || pvBusy) return
    setPvBusy(true)
    const running = pvRunning
    const op = running ? s.previewStop(proj.id) : s.previewStart(proj.id)
    op.then(() => {
      if (!running) {
        const u = pvUrlFor(proj.id)
        if (u) { pvHisAdd(u); navigate(u) }
      }
      window.setTimeout(() => { setPvBusy(false); refreshPv() }, 1200)
    }).catch(() => { setPvBusy(false); refreshPv() })
  }

  const togglePvMenu = (): void => {
    const next = !pvOpen
    setPvOpen(next)
    setPvCtlOpen(false)
    // ★ 每次打开都刷新列表（归档/新建后可见）+ 清理历史残留；
    //   拉取失败也用上一次的列表清理（有列表总比不过滤强）
    if (next) {
      pvListProjects().then((arr) => {
        setPvList(arr)
        setPvLoaded(true)
        pvPruneHistory(arr)
      }).catch(() => { if (pvList.length > 0) pvPruneHistory(pvList) })
    }
  }

  // 重启（软=restart 应用进程 / 硬=hard-restart 重建 Pod）
  const doPvRestart = (hard: boolean): void => {
    const s = pvSvc()
    const proj = pvProjRef.current
    if (!s || !proj || pvBusy) return
    setPvCtlOpen(false)
    setPvBusy(true)
    const op = hard ? s.previewHardRestart(proj.id) : s.previewRestart(proj.id)
    op.then(() => {
      setFlash({ kind: 'ok', text: hard ? '已触发重建 Pod（硬重启，约需数分钟）' : '已触发重启应用（软重启，秒级）' })
      window.setTimeout(() => { setPvBusy(false); refreshPv() }, 2500)
    }).catch((e: any) => {
      setPvBusy(false)
      setFlash({ kind: 'err', text: `操作失败: ${(e && e.message) || e}` })
    })
  }

  const pickPvRow = (row: { url: string; pid: string | null }): void => {
    setPvOpen(false)
    const s = pvSvc()
    const doNav = (): void => { pvHisAdd(row.url); navigate(row.url) }
    if (!row.pid || !s) { doNav(); return }
    s.previewStatus(row.pid).then((d: any) => {
      const v = d && d.ok ? d.value : d
      const running = !!(v && (v.running || v.status === 'running'))
      if (running) { doNav(); return }
      setPvBusy(true)
      s.previewStart(row.pid).then(() => { setPvBusy(false); doNav() })
        .catch(() => { setPvBusy(false); doNav() })
    }).catch(() => doNav())
  }

  const toggleInspect = (): void => {
    if (state.committed === '') {
      setFlash({ kind: 'err', text: t('browser.inspectNeedPage') })
      return
    }
    const next = !state.inspect
    patchBrowserTab(tabId, { inspect: next })
    postInspect(next)
  }

  return (
    <div className={css.root} data-inspect={state.inspect || undefined} data-browser-tab={tabId}>
      <div className={css.bar}>
        <div className={css.nav}>
          <IconButton
            label={t('browser.back')}
            disabled={!canBrowserBack(state)}
            onClick={() => { goBrowserHistory(tabId, -1) }}
          >
            <IconChevronLeft />
          </IconButton>
          <IconButton
            label={t('browser.forward')}
            disabled={!canBrowserForward(state)}
            onClick={() => { goBrowserHistory(tabId, 1) }}
          >
            <IconChevronRight />
          </IconButton>
          <IconButton
            label={t('browser.reload')}
            disabled={state.committed === '' || (pvRunning === false && projId8OfUrl(src) !== null)}
            onClick={() => {
              if (state.committed === '') return
              // ★ 刷新 = 页面重载 + 预览状态重校准：
              //   pod 挂掉后 pvRunning 是 stale true，只重载 iframe 会拿到错误页；
              //   refreshPv 重新拉 status，回 false 后占位符/自动重启链路接管
              refreshPv()
              beginBrowserLoad(tabId)
              const frame = frameRef.current
              if (frame !== null) frame.src = browserViewSrc(state.committed)
            }}
          >
            <IconRefresh />
          </IconButton>
        </div>
        <div className={css.pvCtl}>
          <button
            type="button"
            className={css.pvActBtn}
            data-on={pvRunning || undefined}
            title={pvProjRef.current
              ? `${pvRunning ? '停止' : '启动'}预览：${pvProjRef.current.name}`
              : '预览控制'}
            disabled={pvBusy || !pvSvc() || !pvProjRef.current}
            onClick={togglePvAct}
          >
            {pvBusy ? '…' : pvRunning ? '停止' : '启动'}
          </button>
          <button
            type="button"
            className={css.pvRstBtn}
            title="重启应用 / 重建 Pod"
            disabled={!pvSvc() || !pvProjRef.current || !pvRunning}
            onClick={() => { setPvCtlOpen(!pvCtlOpen); setPvOpen(false) }}
          >
            重启 ▾
          </button>
          {pvCtlOpen && (
            <div className={css.pvMenu} data-ctl>
              <div className={css.pvMenuTitle}>
                {pvProjRef.current ? pvProjRef.current.name : '预览控制'}
              </div>
              <div
                className={css.pvRow}
                data-disabled={(!pvRunning || pvBusy) || undefined}
                onClick={() => { if (pvRunning && !pvBusy) doPvRestart(false) }}
              >
                <span className={css.pvName}>重启应用</span>
                <span className={css.pvTag} data-kind="soft">软 · 秒级</span>
              </div>
              <div
                className={css.pvRow}
                data-disabled={(!pvRunning || pvBusy) || undefined}
                onClick={() => { if (pvRunning && !pvBusy) doPvRestart(true) }}
              >
                <span className={css.pvName}>重建 Pod</span>
                <span className={css.pvTag} data-kind="hard">硬 · 删Pod重建</span>
              </div>
            </div>
          )}
        </div>
        <input
          className={css.address}
          data-invalid={invalid || undefined}
          value={state.input}
          placeholder={t('browser.addressPlaceholder')}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={t('browser.address')}
          onChange={(event) => {
            setInvalid(false)
            patchBrowserTab(tabId, { input: event.target.value })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitAddress()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              patchBrowserTab(tabId, { input: state.committed })
              setInvalid(false)
            }
          }}
        />
        <div className={css.pvWrap}>
          <button
            type="button"
            className={css.pvMain}
            title={pvProjRef.current
              ? `当前项目：${pvProjRef.current.name}（点击切换预览目标）`
              : '切换预览目标'}
            disabled={pvBusy || !pvSvc()}
            onClick={togglePvMenu}
          >
            {pvProjRef.current
              ? (pvProjRef.current.name.length > 8
                ? pvProjRef.current.name.slice(0, 8) + '…'
                : pvProjRef.current.name)
              : '未选择'}
          </button>
          {pvOpen && (
            <div className={css.pvMenu}>
              {pvMergedRows().length === 0 ? (
                <div className={css.pvEmpty}>{pvSvc() ? '暂无项目' : '服务未就绪'}</div>
              ) : pvMergedRows().map(row => (
                <div
                  key={row.url}
                  className={css.pvRow}
                  data-cur={(row.pid != null && pvProjRef.current != null && row.pid === pvProjRef.current.id) || undefined}
                  onClick={() => { pickPvRow(row) }}
                >
                  <span className={css.pvDot} style={{ background: row.pid != null && pvMenuStatus[row.url] ? '#34c759' : 'rgba(255,255,255,.25)' }} />
                  <span className={css.pvName}>
                    {row.name || row.url.replace(/^https:\/\/pv-/, '').replace(/\.<YOUR-DOMAIN>\.com\/?$/, '')}
                  </span>
                  {row.pid != null && (
                    <span className={css.pvTag}>{pvMenuStatus[row.url] ? '运行中' : '未运行'}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={css.actions}>
          <IconButton
            label={state.inspect ? t('browser.inspectOn') : t('browser.inspect')}
            active={state.inspect}
            onClick={toggleInspect}
          >
            <IconInspect />
          </IconButton>
          <IconButton
            label="AI 修复预览"
            disabled={pvFixSending || projId8OfUrl(src) === null}
            onClick={() => { void aiFixPv() }}
          >
            <IconSparkle />
          </IconButton>
          <IconButton label={t('browser.devtools')} onClick={onOpenDevtools}>
            <IconDevtools />
          </IconButton>
        </div>
      </div>
      {state.inspect ? (
        <div className={css.hint} data-kind="inspect">{t('browser.inspectHint')}</div>
      ) : flash !== null ? (
        <div className={css.hint} data-kind={flash.kind}>{flash.text}</div>
      ) : state.status === 'fail' && state.failMessage !== '' ? (
        <div className={css.hint} data-kind="err">
          {state.failMessage}
          {state.failHint !== '' ? ` ${state.failHint}` : ''}
        </div>
      ) : invalid ? (
        <div className={css.hint} data-kind="err">{t('browser.badUrlHint')}</div>
      ) : null}
      <div className={css.stage}>
        {showEmpty ? (
          <div className={css.empty}>
            <p className={css.emptyTitle}>{t('browser.emptyTitle')}</p>
            <p className={css.emptyHint}>{t('browser.emptyHint')}</p>
          </div>
        ) : pvRunning === false && projId8OfUrl(src) !== null ? (
          // ★ fork：预览未运行 → 占位 + 启动按钮（避免 iframe 加载 pv 域裸 404）
          <div className={css.empty}>
            <p className={css.emptyTitle}>预览未启动</p>
            <p className={css.emptyHint}>
              {pvBusy ? '正在启动预览（首次启动需拉取镜像并构建，约 1~3 分钟）…' : '点击下方按钮启动该项目预览'}
            </p>
            {!pvBusy && pvProjRef.current ? (
              <button
                type="button"
                className={css.pvStartBtn}
                onClick={startPv}
              >
                启动预览
              </button>
            ) : null}
          </div>
        ) : (
          <iframe
            ref={frameRef}
            key={src}
            className={css.frame}
            title={t('browser.frame')}
            data-browser-tab={tabId}
            src={src}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer"
            onLoad={() => {
              if (inspectRef.current) postInspect(true)
              frameRef.current?.contentWindow?.postMessage(
                { source: BROWSER_MSG_SOURCE, type: 'query' },
                '*',
              )
              schedulePageDump()
              window.setTimeout(() => { schedulePageDump() }, 900)
            }}
          />
        )}
        {state.status === 'loading' && !showEmpty ? (
          <div className={css.loading}>{t('browser.loading')}</div>
        ) : null}
      </div>
    </div>
  )
}
