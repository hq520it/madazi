import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { redactSecrets } from '../../shared/redact.ts'
import {
  buildCurlCommand,
  NET_REF_DRAG_TYPE,
  type CurlTarget,
  type NetRefSnapshot,
} from '../../shared/browser-net-ref.ts'
import {
  formatBrowserBytes,
  formatBrowserDuration,
  type BrowserAppInfo,
  type BrowserCssSheet,
  type BrowserCssVar,
  type BrowserFileEntry,
  type BrowserNetEntry,
  type BrowserNetType,
  type BrowserStoreRow,
} from '../../shared/browser-devtools.ts'
import {
  loadDevtoolsPane,
  saveDevtoolsPane,
  type DevtoolsDock,
  type DevtoolsPane,
} from './browser-dock.ts'
import {
  clearBrowserConsole,
  clearBrowserNetwork,
  getPreferredBrowserId,
  readPreferredBrowserTab,
  requestBrowserEval,
  requestBrowserProbe,
  subscribeBrowserSession,
  type BrowserConsoleLine,
} from './browser-session.ts'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu.tsx'
import { IconButton } from './IconButton.tsx'
import { IconChat, IconCopy, IconDockBottom, IconRefresh, IconSidePanel, IconTrash } from './icons.tsx'
import type { Translate } from './types.ts'
import css from './DevToolsPanel.module.css'

const DASH = '—'

type ConsoleFilter = 'all' | 'warn' | 'error'
type NetFilter = 'all' | 'xhr' | 'script' | 'stylesheet' | 'image' | 'other'
type AppSection = 'cookies' | 'local' | 'session' | 'db'

function clock(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function lineVisible(line: BrowserConsoleLine, filter: ConsoleFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'error') return line.level === 'error'
  return line.level === 'warn' || line.level === 'error'
}

// ★ 统一时间线（方案 A）：服务日志行解析来源（[server] 生命周期事件 / 其余为构建输出）
function svcSourceOf(text: string): { source: 'server' | 'build'; text: string } {
  if (text.startsWith('[server] ')) return { source: 'server', text: text.slice(9) }
  if (text.startsWith('[server]')) return { source: 'server', text: text.slice(8) }
  return { source: 'build', text }
}

// 构建输出错误特征推断（error 过滤对服务日志生效）
const SVC_ERR_RE = /\b(error|fatal|fail(?:ed|ure)?|ERR|✗)\b/i
function svcIsErr(text: string): boolean {
  return SVC_ERR_RE.test(text)
}

type LogSource = 'server' | 'build' | 'app'
type MergedLine = {
  id: string
  at: number
  source: LogSource
  text: string
  level: string
  prefix: string
  ready: boolean
}

function prefixOf(line: BrowserConsoleLine): string {
  if (line.kind === 'command') return '>'
  if (line.kind === 'result') return '←'
  return ''
}

function typeLabel(kind: BrowserNetType, t: Translate): string {
  return t(`browser.info.type.${kind}`)
}

function netVisible(entry: BrowserNetEntry, filter: NetFilter, query: string): boolean {
  if (query !== '' && !entry.url.toLowerCase().includes(query)) return false
  if (filter === 'all') return true
  if (filter === 'xhr') return entry.resourceType === 'xhr' || entry.resourceType === 'fetch' || entry.resourceType === 'websocket'
  if (filter === 'script') return entry.resourceType === 'script'
  if (filter === 'stylesheet') return entry.resourceType === 'stylesheet'
  if (filter === 'image') return entry.resourceType === 'image'
  return entry.resourceType !== 'xhr'
    && entry.resourceType !== 'fetch'
    && entry.resourceType !== 'websocket'
    && entry.resourceType !== 'script'
    && entry.resourceType !== 'stylesheet'
    && entry.resourceType !== 'image'
}

function statusKind(entry: BrowserNetEntry): 'ok' | 'warn' | 'fail' | 'wait' | '' {
  if (entry.pending) return 'wait'
  if (entry.failed || entry.status >= 400) return 'fail'
  if (entry.status >= 300) return 'warn'
  if (entry.status === 101 || entry.status >= 200) return 'ok'
  return ''
}

function statusLabel(entry: BrowserNetEntry, t: Translate): string {
  if (entry.pending) return t('browser.info.networkPending')
  if (entry.failed && entry.status <= 0) return t('browser.info.networkFailed')
  if (entry.status <= 0) return DASH
  return String(entry.status)
}

function bytesOrDash(n: number): string {
  return formatBrowserBytes(n) || DASH
}

function timeOrDash(n: number): string {
  return formatBrowserDuration(n) || DASH
}

function EmptyNeedPage({ t }: { t: Translate }) {
  return <p className={css.empty}>{t('browser.devtoolsEmpty')}</p>
}

function NetworkPane({
  hasPage,
  activeId,
  rows,
  t,
  pageUrl = '',
  onAddNetToChat,
  onAddTextToChat,
  onAddTermToChat,
}: {
  hasPage: boolean
  activeId: string | null
  rows: BrowserNetEntry[]
  t: Translate
  /** Address-bar URL of the inspected page (route context for chat payloads). */
  pageUrl?: string
  onAddNetToChat?: (snapshot: NetRefSnapshot) => boolean
  onAddTextToChat?: (text: string) => boolean
  /** 终端胶囊（文本 -> 会话卡片），onAddNetToChat 不可用时回退到此 */
  onAddTermToChat?: (text: string, context?: string) => boolean
}) {
  const [filter, setFilter] = useState<NetFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: BrowserNetEntry } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const q = query.trim().toLowerCase()
  const visible = rows.filter(row => netVisible(row, filter, q))
  const selected = visible.find(row => row.id === selectedId) ?? null

  const showToast = (text: string): void => {
    setToast(text)
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setToast(null) }, 2200)
  }

  const copyText = async (text: string, okLabel: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try { document.execCommand('copy') } catch { /* clipboard blocked */ }
      document.body.removeChild(area)
    }
    showToast(okLabel)
  }

  const snapshotOf = (row: BrowserNetEntry): NetRefSnapshot => ({
    method: row.method,
    url: row.url,
    ...(row.requestHeaders !== undefined ? { headers: row.requestHeaders } : {}),
    ...(row.postData !== undefined ? { postData: row.postData } : {}),
    ...(row.pageUrl !== undefined && row.pageUrl !== '' ? { pageUrl: row.pageUrl } : pageUrl !== '' ? { pageUrl } : {}),
  })

  const copyCurl = async (row: BrowserNetEntry, target: CurlTarget): Promise<void> => {
    await copyText(
      buildCurlCommand(row.method, row.url, target, snapshotOf(row)),
      target === 'windows' ? t('browser.info.netCopyCurlWindowsDone') : t('browser.info.netCopyCurlLinuxDone'),
    )
  }

  const openCtxMenu = (event: React.MouseEvent, row: BrowserNetEntry): void => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedId(row.id)
    setCtxMenu({ x: event.clientX, y: event.clientY, row })
  }

  const addToChat = (row: BrowserNetEntry): void => {
    if (onAddNetToChat !== undefined) {
      const ok = onAddNetToChat(snapshotOf(row))
      if (!ok) showToast(t('browser.info.netAddToChatFailed'))
      return
    }
    if (onAddTermToChat !== undefined) {
      const ok = onAddTermToChat(buildCurlCommand(row.method, row.url, 'linux', snapshotOf(row)), t('browser.info.netCtx'))
      if (!ok) showToast(t('browser.info.netAddToChatFailed'))
      return
    }
    if (onAddTextToChat !== undefined) {
      const ok = onAddTextToChat(buildCurlCommand(row.method, row.url, 'linux', snapshotOf(row)))
      if (!ok) showToast(t('browser.info.netAddToChatFailed'))
      return
    }
    void copyText(row.url, t('browser.info.netCopyUrlDone'))
  }

  const ctxItems: ContextMenuEntry[] = ctxMenu === null
    ? []
    : [
        { kind: 'item', id: 'curl-linux', icon: <IconCopy />, label: t('browser.info.netCopyCurlLinux'), onClick: () => { void copyCurl(ctxMenu.row, 'linux') } },
        { kind: 'item', id: 'curl-windows', icon: <IconCopy />, label: t('browser.info.netCopyCurlWindows'), onClick: () => { void copyCurl(ctxMenu.row, 'windows') } },
        { kind: 'sep' },
        { kind: 'item', id: 'copy-url', icon: <IconCopy />, label: t('browser.info.netCopyUrl'), onClick: () => { void copyText(ctxMenu.row.url, t('browser.info.netCopyUrlDone')) } },
        { kind: 'sep' },
        { kind: 'item', id: 'to-chat', icon: <IconChat />, label: t('browser.info.netAddToChat'), onClick: () => { addToChat(ctxMenu.row) } },
      ]

  if (!hasPage) return <EmptyNeedPage t={t} />

  return (
    <div className={css.split}>
      <p className={css.note}>{t('browser.info.networkHint')}</p>
      <div className={css.toolbar}>
        <div className={css.filters}>
          {([
            ['all', t('browser.info.consoleFilterAll')],
            ['xhr', t('browser.info.networkFilterXhr')],
            ['script', t('browser.info.networkFilterScript')],
            ['stylesheet', t('browser.info.networkFilterCss')],
            ['image', t('browser.info.networkFilterImg')],
            ['other', t('browser.info.networkFilterOther')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={css.filter}
              data-active={filter === id || undefined}
              onClick={() => { setFilter(id) }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className={css.search}
          value={query}
          placeholder={t('browser.info.networkSearch')}
          aria-label={t('browser.info.networkSearch')}
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <IconButton
          label={t('browser.info.networkClear')}
          disabled={rows.length === 0}
          onClick={() => {
            if (activeId !== null) clearBrowserNetwork(activeId)
            setSelectedId(null)
          }}
        >
          <IconTrash />
        </IconButton>
      </div>
      <div className={css.tableWrap}>
        {visible.length === 0 ? (
          <p className={css.empty}>
            {rows.length === 0 ? t('browser.info.networkEmpty') : t('browser.info.networkEmptyFilter')}
          </p>
        ) : (
          <table className={css.table}>
            <thead>
              <tr>
                <th className={css.colMethod}>{t('browser.info.networkMethod')}</th>
                <th className={css.colStatus}>{t('browser.info.networkStatus')}</th>
                <th className={css.colType}>{t('browser.info.networkType')}</th>
                <th className={css.colTime}>{t('browser.info.networkTime')}</th>
                <th className={css.colSize}>{t('browser.info.networkSize')}</th>
                <th>{t('browser.info.networkUrl')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const kind = statusKind(row)
                return (
                  <tr
                    key={row.id}
                    className={css.row}
                    data-active={selected?.id === row.id || undefined}
                    draggable
                    title={t('browser.info.netDragHint')}
                    onClick={() => { setSelectedId(row.id) }}
                    onContextMenu={(event) => { openCtxMenu(event, row) }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(NET_REF_DRAG_TYPE, JSON.stringify(snapshotOf(row)))
                      event.dataTransfer.setData('text/plain', buildCurlCommand(row.method, row.url, 'linux', snapshotOf(row)))
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <td>{row.method}</td>
                    <td className={kind === 'ok' ? css.statusOk : kind === 'fail' ? css.statusFail : kind === 'warn' ? css.statusWarn : kind === 'wait' ? css.statusWait : undefined}>
                      {statusLabel(row, t)}
                    </td>
                    <td>{typeLabel(row.resourceType, t)}</td>
                    <td>{timeOrDash(row.durationMs)}</td>
                    <td>{bytesOrDash(row.size)}</td>
                    <td className={css.urlCell} title={row.url}>{row.url}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {selected !== null ? (
        <div className={css.detail}>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkMethod')}</span>
            <span>{selected.method}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkStatus')}</span>
            <span>{statusLabel(selected, t)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkType')}</span>
            <span>{typeLabel(selected.resourceType, t)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkTime')}</span>
            <span>{timeOrDash(selected.durationMs)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkSize')}</span>
            <span>{bytesOrDash(selected.size)}</span>
          </p>
          <p className={css.detailRow}>
            <span className={css.k}>{t('browser.info.networkUrl')}</span>
            <span className={css.v}>{selected.url}</span>
          </p>
        </div>
      ) : null}
      {ctxMenu !== null ? (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          ariaLabel={t('browser.info.networkMenu')}
          onClose={() => { setCtxMenu(null) }}
        />
      ) : null}
      {toast !== null ? <div className={css.toast} role="status">{toast}</div> : null}
    </div>
  )
}

function StoreTable({
  rows,
  empty,
  t,
}: {
  rows: BrowserStoreRow[]
  empty: string
  t: Translate
}) {
  if (rows.length === 0) return <p className={css.empty}>{empty}</p>
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th className={css.colKind}>{t('browser.info.appName')}</th>
          <th>{t('browser.info.appValue')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.name}:${index}`}>
            <td className={css.urlCell} title={row.name}>{row.name || DASH}</td>
            <td className={css.v}>
              {row.value || DASH}
              {row.truncated ? <span className={css.chip}>{t('browser.info.appTruncated')}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ApplicationPane({
  hasPage,
  app,
  t,
}: {
  hasPage: boolean
  app: BrowserAppInfo | null
  t: Translate
}) {
  const [section, setSection] = useState<AppSection>('cookies')
  if (!hasPage) return <EmptyNeedPage t={t} />
  const data = app ?? { cookies: [], localStorage: [], sessionStorage: [], databases: [] }
  return (
    <div className={css.split}>
      <p className={css.note}>{t('browser.info.appHint')}</p>
      <div className={css.toolbar}>
        <div className={css.filters}>
          {([
            ['cookies', t('browser.info.appCookies')],
            ['local', t('browser.info.appLocal')],
            ['session', t('browser.info.appSession')],
            ['db', t('browser.info.appDb')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={css.filter}
              data-active={section === id || undefined}
              onClick={() => { setSection(id) }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={css.tableWrap}>
        {section === 'cookies' ? (
          <StoreTable rows={data.cookies} empty={t('browser.info.appEmptyCookies')} t={t} />
        ) : section === 'local' ? (
          <StoreTable rows={data.localStorage} empty={t('browser.info.appEmptyLocal')} t={t} />
        ) : section === 'session' ? (
          <StoreTable rows={data.sessionStorage} empty={t('browser.info.appEmptySession')} t={t} />
        ) : data.databases.length === 0 ? (
          <p className={css.empty}>{t('browser.info.appEmptyDb')}</p>
        ) : (
          <ul className={css.log}>
            {data.databases.map(name => (
              <li key={name} className={css.logItem}>
                <span className={css.logText}>{name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CssPane({
  hasPage,
  sheets,
  vars,
  t,
}: {
  hasPage: boolean
  sheets: BrowserCssSheet[]
  vars: BrowserCssVar[]
  t: Translate
}) {
  if (!hasPage) return <EmptyNeedPage t={t} />
  return (
    <div className={css.body}>
      <p className={css.bodyNote}>{t('browser.info.cssHint')}</p>
      <h3 className={css.sectionTitle}>{t('browser.info.cssSheets')}</h3>
      {sheets.length === 0 ? (
        <p className={css.empty}>{t('browser.info.cssEmptySheets')}</p>
      ) : sheets.map((sheet, index) => {
        const href = sheet.href || t('browser.info.cssInline')
        const bits: string[] = []
        if (sheet.disabled) bits.push(t('browser.info.cssDisabled'))
        if (sheet.blocked) bits.push(t('browser.info.cssBlocked'))
        else if (sheet.ruleCount !== null) bits.push(`${sheet.ruleCount} ${t('browser.info.cssRules')}`)
        return (
          <div key={`${href}:${index}`} className={css.sheet}>
            <p className={css.sheetTitle} title={href}>{sheet.title ? `${sheet.title} · ${href}` : href}</p>
            <p className={css.sheetMeta}>{bits.join(' · ') || DASH}</p>
          </div>
        )
      })}
      <h3 className={css.sectionTitle}>{t('browser.info.cssVars')}</h3>
      {vars.length === 0 ? (
        <p className={css.empty}>{t('browser.info.cssEmptyVars')}</p>
      ) : (
        <dl className={css.grid}>
          {vars.map(row => (
            <div key={row.name} className={css.pair}>
              <dt className={css.k}>{row.name}</dt>
              <dd className={css.v}>{row.value || DASH}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function FilesPane({
  hasPage,
  files,
  t,
}: {
  hasPage: boolean
  files: BrowserFileEntry[]
  t: Translate
}) {
  const [filter, setFilter] = useState<NetFilter>('all')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visible = files.filter(row => netVisible({
    id: 1,
    method: 'GET',
    url: row.url,
    resourceType: row.kind,
    status: 0,
    durationMs: row.durationMs,
    size: row.size,
    pending: false,
    failed: false,
    startAt: 0,
  }, filter, q))

  if (!hasPage) return <EmptyNeedPage t={t} />

  return (
    <div className={css.split}>
      <p className={css.note}>{t('browser.info.filesHint')}</p>
      <div className={css.toolbar}>
        <div className={css.filters}>
          {([
            ['all', t('browser.info.consoleFilterAll')],
            ['script', t('browser.info.networkFilterScript')],
            ['stylesheet', t('browser.info.networkFilterCss')],
            ['image', t('browser.info.networkFilterImg')],
            ['other', t('browser.info.networkFilterOther')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={css.filter}
              data-active={filter === id || undefined}
              onClick={() => { setFilter(id) }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className={css.search}
          value={query}
          placeholder={t('browser.info.networkSearch')}
          aria-label={t('browser.info.networkSearch')}
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </div>
      <div className={css.tableWrap}>
        {visible.length === 0 ? (
          <p className={css.empty}>
            {files.length === 0 ? t('browser.info.filesEmpty') : t('browser.info.networkEmptyFilter')}
          </p>
        ) : (
          <table className={css.table}>
            <thead>
              <tr>
                <th className={css.colKind}>{t('browser.info.filesKind')}</th>
                <th className={css.colSize}>{t('browser.info.networkSize')}</th>
                <th className={css.colTime}>{t('browser.info.networkTime')}</th>
                <th>{t('browser.info.networkUrl')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.url}>
                  <td>{typeLabel(row.kind, t)}</td>
                  <td>{bytesOrDash(row.size)}</td>
                  <td>{timeOrDash(row.durationMs)}</td>
                  <td className={css.urlCell} title={row.url}>{row.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function DevToolsPanel({
  dock,
  onDock,
  t,
  onAddNetToChat,
  onAddTextToChat,
  onAddTermToChat,
}: {
  dock: DevtoolsDock
  onDock: (dock: DevtoolsDock) => void
  t: Translate
  onAddNetToChat?: (snapshot: NetRefSnapshot) => boolean
  onAddTextToChat?: (text: string) => boolean
  /** 终端胶囊（文本 -> 会话卡片）：Console 日志和网络回退共用 */
  onAddTermToChat?: (text: string, context?: string) => boolean
}) {
  const state = useSyncExternalStore(subscribeBrowserSession, readPreferredBrowserTab, readPreferredBrowserTab)
  const activeId = useSyncExternalStore(subscribeBrowserSession, getPreferredBrowserId, getPreferredBrowserId)
  const page = state.page
  const hasPage = activeId !== null && state.committed !== ''
  const [pane, setPane] = useState<DevtoolsPane>(() => loadDevtoolsPane())
  const [filter, setFilter] = useState<ConsoleFilter>('all')
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLUListElement | null>(null)
  // ── fork 定制：Console 聚合预览 Pod 服务日志 ──
  const [svcLines, setSvcLines] = useState<Array<{ id: number; text: string; at: number }>>([])
  const [svcErr, setSvcErr] = useState(false)
  const [svcNote, setSvcNote] = useState<string | null>(null)
  // ★ 统一时间线：来源过滤开关（server=平台事件 build=构建 app=浏览器）
  const [srcOn, setSrcOn] = useState<{ server: boolean; build: boolean; app: boolean }>({ server: true, build: true, app: true })
  const svcIdRef = useRef(0)
  const lastPidRef = useRef<string | null>(null)
  // ── fork 定制：Console 日志右键菜单（复制 / 添加到对话）——启动与运行期日志通用，
  //   优先取当前选区（支持跨多行框选），无选区则用被点行的文本 ──
  const [logCtx, setLogCtx] = useState<{ x: number; y: number; text: string } | null>(null)
  const [logToast, setLogToast] = useState<string | null>(null)
  const logToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showLogToast = (text: string): void => {
    setLogToast(text)
    if (logToastTimer.current !== null) clearTimeout(logToastTimer.current)
    logToastTimer.current = setTimeout(() => { setLogToast(null) }, 2200)
  }
  const copyLogText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try { document.execCommand('copy') } catch { /* clipboard blocked */ }
      document.body.removeChild(area)
    }
    showLogToast(t('browser.info.consoleCopyDone'))
  }
  const openLogCtx = (event: React.MouseEvent, lineText: string): void => {
    event.preventDefault()
    const sel = window.getSelection()
    const selected = sel !== null && !sel.isCollapsed ? sel.toString().trim() : ''
    const text = selected !== '' ? selected : lineText
    if (text === '') return
    setLogCtx({ x: event.clientX, y: event.clientY, text })
  }
  const addLogToChat = (text: string): void => {
    if (onAddTermToChat !== undefined) {
      const ok = onAddTermToChat(text, t('browser.info.consoleCtx'))
      if (!ok) {
        void copyLogText(text)
        showLogToast(t('browser.info.netAddToChatFailed'))
      }
      return
    }
    const ok = onAddTextToChat !== undefined ? onAddTextToChat(text) : false
    if (!ok) {
      void copyLogText(text)
      showLogToast(t('browser.info.netAddToChatFailed'))
    }
  }
  const logCtxItems: ContextMenuEntry[] = logCtx === null
    ? []
    : [
        { kind: 'item', id: 'copy', icon: <IconCopy />, label: t('browser.info.consoleCopy'), onClick: () => { void copyLogText(logCtx.text) } },
        { kind: 'item', id: 'to-chat', icon: <IconChat />, label: t('browser.info.consoleAddToChat'), onClick: () => { addLogToChat(logCtx.text) } },
      ]
  const lines = Array.isArray(state.console) ? state.console : []
  // ★ 统一时间线：服务日志（去前缀→来源徽标）与浏览器 console 按时间 at 交织排序
  const merged = useMemo<MergedLine[]>(() => {
    const svc: MergedLine[] = svcLines.map(l => {
      const { source, text } = svcSourceOf(l.text)
      return {
        id: 's' + String(l.id),
        at: l.at,
        source,
        text,
        level: svcIsErr(text) ? 'error' : 'info',
        prefix: source,
        ready: source === 'server' && text.includes('预览就绪'),
      }
    })
    const app: MergedLine[] = lines.map(l => ({
      id: 'a' + String((l as { id?: number | string }).id ?? Math.random()),
      at: (l as { at?: number }).at ?? Date.now(),
      source: 'app',
      text: l.text,
      level: l.level,
      prefix: prefixOf(l) !== '' ? prefixOf(l) : 'app',
      ready: false,
    }))
    return [...svc, ...app].sort((a, b) => a.at - b.at).slice(-2000)
  }, [svcLines, lines])
  const visible = merged.filter(l =>
    srcOn[l.source]
    && (filter === 'all' || (filter === 'error' ? l.level === 'error' : l.level === 'warn' || l.level === 'error')),
  )
  const network = Array.isArray(state.network) ? state.network : []
  const sheets = Array.isArray(state.cssSheets) ? state.cssSheets : []
  const vars = Array.isArray(state.cssVars) ? state.cssVars : []
  const files = Array.isArray(state.files) ? state.files : []

  useEffect(() => {
    const el = logRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
  }, [visible.length, pane, svcLines.length])

  // fork 定制：Console 聚合预览 Pod 服务日志（构建+启动+后端+前端 stdout，增量拉取桥内 WS 缓存）
  useEffect(() => {
    if (pane !== 'console' || activeId === null) {
      console.log('[madazi-log] skip: pane=', pane, 'activeId=', activeId)
      return
    }
    const s = (window as unknown as { __madaziSvc?: { [k: string]: any } }).__madaziSvc
    if (!s || typeof s.previewLogs !== 'function') {
      console.log('[madazi-log] skip: svc.previewLogs not a function', typeof s?.previewLogs)
      return
    }
    let stopped = false
    let pid8: string | null = null
    let ws: WebSocket | null = null
    let keepalive: number | undefined
    let retryTimer: number | undefined
    // ★ 浏览器直连 WS（同源 cookie 鉴权，不依赖 typert/bridge 声明）：server 推
    //   [server] 生命周期事件（镜像选择/Pod 创建/就绪）+ Pod stdout（构建→前后端启动→运行时）完整时间线。
    //   reset=true 全量重置（重连/pod 重建）；增量 append；断线 2s 重连（重连首包必为全量 reset）
    const appendLines = (text: string, reset: boolean): void => {
      setSvcLines(prev => {
        const next = reset ? [] : [...prev]
        for (const ln of text.split('\n')) {
          if (ln.trim() === '') continue
          next.push({ id: ++svcIdRef.current, text: ln, at: Date.now() })
        }
        return next.slice(-1500)
      })
    }
    const closeLogWs = (): void => {
      if (keepalive) { window.clearInterval(keepalive); keepalive = undefined }
      if (ws) { try { ws.close() } catch { /* ignore */ } ws = null }
    }
    const openLogWs = (): void => {
      if (stopped || !pid8 || ws) return
      try {
        ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/ws/preview-log?projectId=${pid8}`)
      } catch { ws = null; return }
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const m = JSON.parse(String(ev.data))
          if (m.type === 'log' && typeof m.text === 'string' && m.text) {
            appendLines(m.text, m.reset === true)
            setSvcErr(false)
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        ws = null
        if (!stopped && pid8) window.setTimeout(() => { openLogWs() }, 2000)
      }
      ws.onerror = () => { if (!stopped) setSvcErr(true) }
      // 25s 心跳：项目就绪后运行时日志稀疏，防 nginx idle 超时断连
      keepalive = window.setInterval(() => {
        if (ws && ws.readyState === 1) ws.send('{"type":"ping"}')
      }, 25000)
    }
    // ★ committed 可能是编码 URL（view?u=https%3A%2F%2Fpv-xxxx.…），decode 后再匹配，否则 pv 正则永远落空
    let committedStr = ''
    try { committedStr = decodeURIComponent(String(state.committed || '')) } catch { committedStr = String(state.committed || '') }
    const m = committedStr.match(/\/\/pv-([0-9a-fA-F]{8})\./)
    if (m) {
      pid8 = m[1].toLowerCase()
      // ★ 地址切换项目：关旧 WS、日志区清空重新滚动
      if (lastPidRef.current !== pid8) { lastPidRef.current = pid8; closeLogWs(); setSvcLines([]) }
      setSvcNote(null)
      openLogWs()
    } else {
      // fork 兜底：committed 无 pv 匹配（预览开新标签等场景）→ 查运行中预览列表
      console.log('[madazi-log] committed no pv match, trying running list')
      ;(async () => {
        if (stopped) return
        try {
          const r = await (s.listRunningPreviews as any)()
          const v = r && r.ok ? r.value : r
          const list = (v && v.running) || []
          // ★ 只跟随「当前选中项目」的预览（activeId 前 8 位匹配），绝不跨项目 fallback
          const curPid = activeId ? String(activeId).slice(0, 8).toLowerCase() : null
          const hit = curPid ? list.find((x: any) => String(x.pid8 || '').toLowerCase() === curPid) : null
          if (hit) {
            pid8 = String(hit.pid8 || '').toLowerCase()
            if (lastPidRef.current !== pid8) { lastPidRef.current = pid8; closeLogWs(); setSvcLines([]) }
            setSvcNote(null)
            openLogWs()
          } else if (list.length > 0 && !curPid) {
            // 无 activeId（面板级/新标签）：取最近启动的 running 项目
            const sorted = [...list].sort((a: any, b: any) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
            pid8 = String(sorted[0].pid8 || '').toLowerCase()
            if (lastPidRef.current !== pid8) { lastPidRef.current = pid8; closeLogWs(); setSvcLines([]) }
            setSvcNote(null)
            openLogWs()
          } else {
            // ★ 选中项目未运行：不轮询别的项目，清空并提示；每 2s 重查 running 列表，
            //   pod 拉起（构建中即进列表）后自动 follow，保证构建日志能实时打出来
            console.log('[madazi-log] skip: active project not running, waiting for start')
            setSvcLines([])
            setSvcNote('预览未启动：等待自动启动（首次约 1~3 分钟），启动后自动显示构建日志')
            pid8 = null
            if (!retryTimer) {
              retryTimer = window.setInterval(() => {
                if (stopped || pid8) {
                  if (retryTimer) { window.clearInterval(retryTimer); retryTimer = undefined }
                  return
                }
                ;(async () => {
                  try {
                    const r = await (s.listRunningPreviews as any)()
                    const v = r && r.ok ? r.value : r
                    const list = (v && v.running) || []
                    const curPid2 = activeId ? String(activeId).slice(0, 8).toLowerCase() : null
                    const hit2 = curPid2 ? list.find((x: any) => String(x.pid8 || '').toLowerCase() === curPid2) : null
                    if (hit2) {
                      pid8 = String(hit2.pid8 || '').toLowerCase()
                      if (lastPidRef.current !== pid8) { lastPidRef.current = pid8; closeLogWs(); setSvcLines([]) }
                      setSvcNote(null)
                      openLogWs()
                      if (retryTimer) { window.clearInterval(retryTimer); retryTimer = undefined }
                    }
                  } catch { /* ignore */ }
                })()
              }, 2000)
            }
          }
        } catch (e: any) {
          console.log('[madazi-log] err listRunningPreviews', e)
        }
      })()
    }
    return () => {
      stopped = true
      closeLogWs()
      if (retryTimer) window.clearInterval(retryTimer)
    }
  }, [pane, activeId, state.committed])

  useEffect(() => {
    if (!hasPage || activeId === null) return
    if (pane === 'console') return
    requestBrowserProbe(activeId)
  }, [pane, hasPage, activeId, state.committed])

  const runEval = (): void => {
    if (activeId === null || !hasPage) return
    const code = draft.trim()
    if (code === '') return
    requestBrowserEval(activeId, code)
    setDraft('')
  }

  const changePane = (next: DevtoolsPane): void => {
    setPane(next)
    saveDevtoolsPane(next)
  }

  const tabs: Array<{ id: DevtoolsPane; label: string }> = [
    { id: 'console', label: t('browser.info.console') },
    { id: 'network', label: t('browser.info.network') },
    { id: 'application', label: t('browser.info.application') },
    { id: 'css', label: t('browser.info.css') },
    { id: 'files', label: t('browser.info.files') },
    { id: 'page', label: t('browser.info.page') },
  ]

  const showRefresh = hasPage && pane !== 'console'

  return (
    <section className={css.root} aria-label={t('browser.devtools')}>
      <div className={css.head}>
        <div className={css.panes} role="tablist">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={css.pane}
              role="tab"
              aria-selected={pane === tab.id}
              data-active={pane === tab.id || undefined}
              onClick={() => { changePane(tab.id) }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {showRefresh ? (
          <IconButton
            label={t('browser.info.refresh')}
            onClick={() => { if (activeId !== null) requestBrowserProbe(activeId) }}
          >
            <IconRefresh />
          </IconButton>
        ) : null}
        {dock === 'bottom' ? (
          <IconButton label={t('browser.devtoolsToSide')} onClick={() => { onDock('side') }}>
            <IconSidePanel />
          </IconButton>
        ) : (
          <IconButton label={t('browser.devtoolsToBottom')} onClick={() => { onDock('bottom') }}>
            <IconDockBottom />
          </IconButton>
        )}
      </div>
      {pane === 'network' ? (
        <NetworkPane
          hasPage={hasPage}
          activeId={activeId}
          rows={network}
          t={t}
          pageUrl={page?.url || state.committed}
          onAddNetToChat={onAddNetToChat}
          onAddTextToChat={onAddTextToChat}
          onAddTermToChat={onAddTermToChat}
        />
      ) : pane === 'application' ? (
        <ApplicationPane hasPage={hasPage} app={state.app} t={t} />
      ) : pane === 'css' ? (
        <CssPane hasPage={hasPage} sheets={sheets} vars={vars} t={t} />
      ) : pane === 'files' ? (
        <FilesPane hasPage={hasPage} files={files} t={t} />
      ) : pane === 'page' ? (
        <div className={css.body}>
          {!hasPage ? (
            <EmptyNeedPage t={t} />
          ) : (
            <dl className={css.grid}>
              <dt className={css.k}>{t('browser.info.url')}</dt>
              <dd className={css.v}>{redactSecrets(page?.url || state.committed) || DASH}</dd>
              <dt className={css.k}>{t('browser.info.title')}</dt>
              <dd className={css.v}>{page?.title || state.title || DASH}</dd>
              <dt className={css.k}>{t('browser.info.viewport')}</dt>
              <dd className={css.v}>
                {page !== null && page.viewport.w > 0
                  ? `${page.viewport.w} × ${page.viewport.h}`
                  : DASH}
              </dd>
              <dt className={css.k}>{t('browser.info.secure')}</dt>
              <dd className={css.v}>
                {page?.secure === true ? t('browser.info.secureYes') : t('browser.info.secureNo')}
              </dd>
              <dt className={css.k}>{t('browser.info.cookiesEnabled')}</dt>
              <dd className={css.v}>
                {page?.cookiesEnabled === false ? t('browser.info.no') : t('browser.info.yes')}
              </dd>
              <dt className={css.k}>{t('browser.info.ua')}</dt>
              <dd className={css.v}>{page?.ua || (typeof navigator !== 'undefined' ? navigator.userAgent : DASH)}</dd>
            </dl>
          )}
        </div>
      ) : (
        <>
          <div className={css.toolbar}>
            <div className={css.filters}>
              {([
                ['all', t('browser.info.consoleFilterAll')],
                ['warn', t('browser.info.consoleFilterWarn')],
                ['error', t('browser.info.consoleFilterError')],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={css.filter}
                  data-active={filter === id || undefined}
                  onClick={() => { setFilter(id) }}
                >
                  {label}
                </button>
              ))}
              <span className={css.srcChips}>
                {(['server', 'build', 'app'] as const).map(src => (
                  <button
                    key={src}
                    type="button"
                    className={css.srcChip}
                    data-src={src}
                    data-on={srcOn[src] || undefined}
                    onClick={() => { setSrcOn(p => ({ ...p, [src]: !p[src] })) }}
                  >
                    {src}
                  </button>
                ))}
              </span>
            </div>
            {svcLines.length > 0 ? (
              <span className={css.liveState} data-err={svcErr || undefined}>
                {svcErr ? '⚠ 重连中' : '● 实时'}
              </span>
            ) : null}
            <IconButton
              label={t('browser.info.consoleClear')}
              disabled={lines.length === 0 && svcLines.length === 0}
              onClick={() => {
                if (activeId !== null) clearBrowserConsole(activeId)
                setSvcLines([])
              }}
            >
              <IconTrash />
            </IconButton>
          </div>
          <ul ref={logRef} className={css.log} aria-live="polite">
            {visible.length === 0 ? (
              <li className={css.logEmpty}>
                {svcNote ?? (hasPage ? t('browser.info.consoleEmpty') : t('browser.devtoolsEmpty'))}
              </li>
            ) : (
              visible.map(line =>
                line.ready ? (
                  <li
                    key={line.id}
                    className={css.logReady}
                    onContextMenu={(event) => { openLogCtx(event, `${line.prefix} ${line.text}`.trim()) }}
                  >
                    <span>{line.text}</span>
                  </li>
                ) : (
                  <li
                    key={line.id}
                    className={css.logItem}
                    data-level={line.level}
                    data-source={line.source}
                    onContextMenu={(event) => { openLogCtx(event, `${line.prefix} ${line.text || DASH}`.trim()) }}
                  >
                    <span className={css.prefix}>{line.prefix}</span>
                    <span className={css.logText}>{line.text || DASH}</span>
                    <span className={css.time}>{clock(line.at)}</span>
                  </li>
                ),
              )
            )}
          </ul>
          <form
            className={css.prompt}
            onSubmit={(event) => {
              event.preventDefault()
              runEval()
            }}
          >
            <span className={css.promptMark} aria-hidden>{'>'}</span>
            <input
              className={css.promptInput}
              value={draft}
              disabled={!hasPage}
              placeholder={hasPage ? t('browser.info.consoleEvalPlaceholder') : t('browser.info.consoleEvalNeedPage')}
              aria-label={t('browser.info.consoleEval')}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => { setDraft(event.target.value) }}
            />
          </form>
          {logCtx !== null ? (
            <ContextMenu
              x={logCtx.x}
              y={logCtx.y}
              items={logCtxItems}
              ariaLabel={t('browser.info.consoleMenu')}
              onClose={() => { setLogCtx(null) }}
            />
          ) : null}
          {logToast !== null ? <div className={css.toast} role="status">{logToast}</div> : null}
        </>
      )}
    </section>
  )
}