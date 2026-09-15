import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { GitClient } from '../api.ts'
import type { GitFail } from '../../shared/types.ts'
import { IconButton } from './IconButton.tsx'
import { joinWorkspaceFile, suggestNewFileDir, termIdFromTabId } from '../../shared/new-file-path.ts'
import { IconChat, IconClose, IconDiff, IconEditor, IconEye, IconGlobe, IconMore, IconPanelOff, IconPlus, IconRefresh, IconRestore, IconSave, IconSplit, IconTerminal, IconTrash } from './icons.tsx'
import { parseDiffHunks, rejectHunks, type DiffHunk } from './change-review.ts'
import { PathBreadcrumb } from './PathBreadcrumb.tsx'
import { TerminalView } from './TerminalView.tsx'
import { BrowserView } from './BrowserView.tsx'
import { TERMINAL_TAB_ID, browserTabLabel, terminalTabLabel, type FileBuffer, type FileTab, type Translate } from './types.ts'
import { CodeEditor } from './CodeEditor.tsx'
import { isMarkdownPath } from './code-language.ts'
import type { EditorModeId } from './editor-mode.ts'
import { FilePreview } from './FilePreview.tsx'
import { MarkdownPreview } from './MarkdownPreview.tsx'
import type { BrowserElSnapshot } from '../../shared/browser-el.ts'
import type { EditorRefSnapshot } from '../../shared/editor-ref.ts'
import type { EditorVimOps } from './types.ts'
import type { TermCleanExitAction } from './term-session.ts'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu.tsx'
import { ColSash, RowSash } from './ColSash.tsx'
import css from './EditorPane.module.css'

export interface EditorPaneProps {
  client: GitClient
  workspaceId?: string
  tabs: FileTab[]
  activeId: string | null
  buffers: Record<string, FileBuffer>
  onOpenFile: (path: string) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseMany: (ids: string[]) => void
  onDraft: (path: string, draft: string) => void
  onSaved: (path: string, content: string, version?: string) => void
  /** Re-read a file and replace its buffer (conflict dialog "reload latest"). */
  onReload?: (path: string) => void
  onCollapse?: () => void
  notice?: GitFail | null
  termSeed?: string
  workspaceTitle?: string
  leadingSash?: ReactNode
  onNewTerminal?: () => void
  onNewBrowser?: () => void
  onOpenDevtools?: () => void
  onPickBrowserEl?: (snapshot: BrowserElSnapshot) => boolean
  onBrowserTitle?: (tabId: string, title: string, url: string) => void
  onCreateFile?: (path: string) => Promise<GitFail | null>
  aiTermIds?: readonly string[]
  onAiModeChange?: (tabId: string, open: boolean) => void
  editorMode: EditorModeId
  onDockToBottom?: () => void
  onTermCleanExit?: (tabId: string) => TermCleanExitAction
  terminalDocked?: boolean
  /** Editor selection / whole file → official composer chip. */
  onAddEditorToChat?: (snapshot: EditorRefSnapshot) => boolean
  t: Translate
}

function fileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function tabLabelOf(tab: FileTab, t: Translate): string {
  if (tab.kind === 'terminal') return terminalTabLabel(tab, t)
  if (tab.kind === 'browser') return browserTabLabel(tab, t)
  if (tab.kind === 'diff') return `${fileName(tab.path)} · ${t('editor.diffTab')}`
  if (tab.kind === 'commitDiff') return `${fileName(tab.path)} · ${t('editor.commitDiffTab')}`
  return fileName(tab.path)
}

function parseDiff(text: string): Array<{ kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx'; text: string }> {
  if (text.trim() === '') return []
  return text.split(/\r?\n/).map((line) => {
    if (
      line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')
      || line.startsWith('index ') || line.startsWith('new file ') || line.startsWith('deleted file ')
      || line.startsWith('old mode ') || line.startsWith('new mode ')
      || line.startsWith('rename from ') || line.startsWith('rename to ')
      || line.startsWith('copy from ') || line.startsWith('copy to ')
      || line.startsWith('similarity index') || line.startsWith('Binary files ')
    ) {
      return { kind: 'meta' as const, text: line }
    }
    if (line.startsWith('@@')) return { kind: 'hunk' as const, text: line }
    if (line.startsWith('+')) return { kind: 'add' as const, text: line }
    if (line.startsWith('-')) return { kind: 'del' as const, text: line }
    return { kind: 'ctx' as const, text: line }
  })
}

function isBinaryDiff(text: string): boolean {
  return /^Binary files /m.test(text)
}

function isNewEmptyDiff(
  text: string,
  rows: Array<{ kind: 'add' | 'del' | 'hunk' | 'meta' | 'ctx' }>,
): boolean {
  if (rows.some(row => row.kind === 'add' || row.kind === 'del')) return false
  return /^new file /m.test(text) || /^--- \/dev\/null$/m.test(text)
}

type MdViewMode = 'edit' | 'preview' | 'split'

/** Center editor: explorer + tabs + text/diff, with unsaved-close confirmation. */
export function EditorPane({
  client, workspaceId, tabs, activeId, buffers,
  onOpenFile, onActivate, onClose, onCloseMany, onDraft, onSaved, onReload, onCollapse, notice, termSeed, workspaceTitle, leadingSash, onNewTerminal, onNewBrowser, onOpenDevtools, onPickBrowserEl, onBrowserTitle, onCreateFile, aiTermIds, onAiModeChange, editorMode, onDockToBottom, onTermCleanExit, terminalDocked, onAddEditorToChat, t,
}: EditorPaneProps) {
  const active = tabs.find(tab => tab.id === activeId) ?? null
  const buffer = active?.kind === 'file' ? buffers[active.path] : undefined
  const dirty = buffer !== undefined && buffer.draft !== buffer.original
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<GitFail | null>(null)
  /** Save rejected by the version guard: the file changed since it was read. */
  const [staleConflict, setStaleConflict] = useState<{ id: string; path: string } | null>(null)
  const [pendingClose, setPendingClose] = useState<{ ids: string[]; names: string[] } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileDir, setNewFileDir] = useState('')
  const [newFileName, setNewFileName] = useState('未命名.txt')
  const [newFileBusy, setNewFileBusy] = useState(false)
  const [newFileError, setNewFileError] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  /** Bump to re-run the diff load effect (refresh button / after a reject write). */
  const [diffRev, setDiffRev] = useState(0)
  /** True while a hunk/file reject is being read-validated-written. */
  const [rejecting, setRejecting] = useState(false)
  /** Transient outcome of the last reject attempt (success / stale / failed). */
  const [rejectNotice, setRejectNotice] = useState<'done' | 'stale' | 'failed' | null>(null)
  /** New-file reject-all confirmation target (delete instead of empty rewrite). */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [mdView, setMdView] = useState<Record<string, MdViewMode>>({})
  const [termChromeHost, setTermChromeHost] = useState<HTMLSpanElement | null>(null)
  // Split panes: only the editor body is split — the chrome (crumb row, tab
  // bar, actions) stays single. splitId is the tab shown in the second pane.
  const [editorSplit, setEditorSplit] = useState<'none' | 'v' | 'h'>('none')
  const [splitId, setSplitId] = useState<string | null>(null)
  const [splitFrac, setSplitFrac] = useState(0.5)
  const [splitFocus, setSplitFocus] = useState<'a' | 'b'>('a')
  const splitHostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if ((active?.kind !== 'diff' && active?.kind !== 'commitDiff') || workspaceId === undefined) {
      setDiffText('')
      setDiffLoading(false)
      return
    }
    let cancelled = false
    setDiffLoading(true)
    const load = active.kind === 'commitDiff'
      ? client.commitDiff(workspaceId, active.hash ?? '', active.path, active.repo)
      : client.diff(workspaceId, active.path, active.staged === true, active.repo)
    void load.then((result) => {
      if (cancelled) return
      setDiffLoading(false)
      if (result.ok) {
        setError(null)
        setDiffText(result.value.text)
      } else {
        setError(result)
        setDiffText('')
      }
    })
    return () => { cancelled = true }
  }, [active, client, workspaceId, diffRev])

  // 撤销结果提示只跟随 tab 切换清除；reject 之后的 diff 刷新不清（否则看不到"已撤销"）。
  useEffect(() => {
    setRejectNotice(null)
  }, [activeId])

  const requestClose = (id: string): void => {
    const tab = tabs.find(item => item.id === id)
    if (tab?.kind === 'file') {
      const current = buffers[tab.path]
      if (current !== undefined && current.draft !== current.original) {
        setPendingClose({ ids: [id], names: [fileName(tab.path)] })
        return
      }
    }
    onClose(id)
  }

  const requestCloseMany = (ids: string[]): void => {
    if (ids.length === 0) return
    const names: string[] = []
    for (const id of ids) {
      const tab = tabs.find(item => item.id === id)
      if (tab?.kind !== 'file') continue
      const current = buffers[tab.path]
      if (current !== undefined && current.draft !== current.original) names.push(fileName(tab.path))
    }
    if (names.length > 0) {
      setPendingClose({ ids, names })
      return
    }
    onCloseMany(ids)
  }

  const openTabMenu = (event: ReactMouseEvent, id: string): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenuOpen(false)
    setAddOpen(false)
    setTabMenu({ x: event.clientX, y: event.clientY, tabId: id })
  }

  /** Save one tab's buffer; resolves true only when the write succeeded.
   *  `force` skips the version guard (user chose "overwrite" in the conflict
   *  dialog). Normal saves send the read-time version as expectedVersion so a
   *  concurrent change (AI session / another member) fails with FS_STALE_VERSION
   *  instead of silently overwriting. */
  const saveTab = async (id: string, force = false): Promise<boolean> => {
    const tab = tabs.find(item => item.id === id)
    if (workspaceId === undefined || tab?.kind !== 'file') return false
    const current = buffers[tab.path]
    if (current === undefined || current.draft === current.original || saving) return false
    setSaving(true)
    const result = await client.writeFile(workspaceId, tab.path, current.draft, force ? undefined : current.version)
    setSaving(false)
    if (!result.ok) {
      if (result.code === 'FS_STALE_VERSION') {
        setError(null)
        setStaleConflict({ id: tab.id, path: tab.path })
      } else {
        setError(result)
      }
      return false
    }
    setError(null)
    setStaleConflict(null)
    onSaved(tab.path, current.draft, result.value.version)
    return true
  }

  /** Save the active tab (toolbar / Mod-s on the primary pane). */
  const save = (): Promise<boolean> => active?.id !== undefined
    ? saveTab(active.id)
    : Promise.resolve(false)

  /** Selected text / whole file of one tab → official composer chip. */
  const addEditorToChat = (tabId: string | null, text: string, kind: 'selection' | 'file'): boolean => {
    const tab = tabId === null ? undefined : tabs.find(item => item.id === tabId)
    if (onAddEditorToChat === undefined || tab?.kind !== 'file') return false
    return onAddEditorToChat({ text, path: tab.path, kind })
  }

  const markdownOpen = active?.kind === 'file' && buffer !== undefined && isMarkdownPath(active.path)
  const mdMode: MdViewMode = markdownOpen && active !== null ? (mdView[active.path] ?? 'edit') : 'edit'

  // —— AI 改动审查：未暂存 diff 视图的按块 / 按文件撤销 ——
  // staged / commitDiff 不参与：撤销写的是工作区文件，对暂存区/历史提交无意义。
  const diffRows = useMemo(() => parseDiff(diffText), [diffText])
  const diffHunks = useMemo(() => parseDiffHunks(diffText), [diffText])
  const diffTab = active?.kind === 'diff' ? active : null
  const diffNewEmpty = !diffLoading && isNewEmptyDiff(diffText, diffRows)
  /** 新建文件（全量新增 diff 或空新文件）：全部撤销 = 删除文件，而非写回空内容。 */
  const diffNewFile = diffTab !== null && diffTab.staged !== true && !diffLoading
    && ((diffHunks.length > 0 && diffHunks.every(h => h.oldStart === 0 && h.oldCount === 0)) || diffNewEmpty)
  const rejectable = diffTab !== null && diffTab.staged !== true && !diffLoading && !rejecting

  const refreshDiff = (): void => { setDiffRev(n => n + 1) }

  /** 读当前内容 → 校验 hunk 未过期 → 旧侧回写（expectedVersion 乐观锁防并发覆盖）。 */
  const rejectDiffHunks = async (indexes: ReadonlySet<number>): Promise<void> => {
    if (workspaceId === undefined || diffTab === null || diffTab.staged === true || rejecting) return
    setRejecting(true)
    try {
      const read = await client.readFile(workspaceId, diffTab.path)
      if (!read.ok) {
        setError(read)
        setRejectNotice('failed')
        return
      }
      const next = rejectHunks(read.value.content, diffHunks, indexes)
      if (next === null) {
        // 文件在 diff 生成后又被改过（行内容对不上）→ 刷新后重试
        setRejectNotice('stale')
        refreshDiff()
        return
      }
      const write = await client.writeFile(workspaceId, diffTab.path, next, read.value.version)
      if (!write.ok) {
        if (write.code === 'FS_STALE_VERSION') setRejectNotice('stale')
        else {
          setError(write)
          setRejectNotice('failed')
        }
        refreshDiff()
        return
      }
      setError(null)
      setRejectNotice('done')
      onReload?.(diffTab.path)
      refreshDiff()
    } finally {
      setRejecting(false)
    }
  }

  const rejectAllChanges = (): void => {
    if (!rejectable) return
    setRejectNotice(null)
    if (diffNewFile) {
      setPendingDelete(diffTab!.path)
      return
    }
    void rejectDiffHunks(new Set(diffHunks.map(h => h.index)))
  }

  const confirmDeleteNewFile = async (): Promise<void> => {
    const path = pendingDelete
    setPendingDelete(null)
    if (path === null || workspaceId === undefined) return
    setRejecting(true)
    try {
      const result = await client.deleteFile(workspaceId, path)
      if (!result.ok) {
        setError(result)
        setRejectNotice('failed')
        return
      }
      setError(null)
      setRejectNotice('done')
      const id = active?.id
      if (id !== undefined) onClose(id)
    } finally {
      setRejecting(false)
    }
  }

  useEffect(() => {
    if (mdMode !== 'preview') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 's' || !(event.ctrlKey || event.metaKey) || event.altKey) return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [mdMode, active, buffer, dirty, saving, workspaceId])

  const submitNewFile = async (): Promise<void> => {
    if (onCreateFile === undefined) return
    const path = joinWorkspaceFile(newFileDir, newFileName)
    if (path === null) {
      setNewFileError(t('editor.addFileInvalid'))
      return
    }
    setNewFileBusy(true)
    const fail = await onCreateFile(path)
    setNewFileBusy(false)
    if (fail !== null) {
      setNewFileError(fail.messageZh)
      return
    }
    setNewFileOpen(false)
  }

  const activeIndex = activeId === null ? -1 : tabs.findIndex(tab => tab.id === activeId)
  const closableIds = tabs.filter(tab => tab.kind !== 'terminal').map(tab => tab.id)
  const closeAllIds = closableIds
  const closeOthersIds = activeIndex >= 0
    ? closableIds.filter(id => id !== activeId)
    : closableIds
  const closeLeftIds = activeIndex > 0
    ? tabs.slice(0, activeIndex).filter(tab => tab.kind !== 'terminal').map(tab => tab.id)
    : []
  const closeRightIds = activeIndex >= 0 && activeIndex < tabs.length - 1
    ? tabs.slice(activeIndex + 1).filter(tab => tab.kind !== 'terminal').map(tab => tab.id)
    : []

  /** Open a split; the second pane shows another open file tab (or the same
   *  file when that's all there is), like opening one more editor tab. */
  const openSplit = (dir: 'v' | 'h'): void => {
    setEditorSplit(dir)
    setSplitId((current) => {
      if (current !== null && tabs.some(tab => tab.id === current)) return current
      const files = tabs.filter(tab => tab.kind === 'file')
      const other = files.find(tab => tab.id !== activeId) ?? files[0]
      return other?.id ?? null
    })
  }

  const closeSplit = (): void => {
    setEditorSplit('none')
    setSplitId(null)
    setSplitFocus('a')
  }

  // Keep the split pane on a live tab; close the split when no tab is left.
  useEffect(() => {
    if (editorSplit === 'none') return
    if (splitId !== null && tabs.some(tab => tab.id === splitId)) return
    const files = tabs.filter(tab => tab.kind === 'file')
    const other = files.find(tab => tab.id !== activeId) ?? files[0]
    if (other !== undefined) setSplitId(other.id)
    else closeSplit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSplit, splitId, tabs, activeId])

  const beginSplitResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    try { handle.setPointerCapture(pointerId) } catch { /* pointer already inactive */ }
    const startX = event.clientX
    const startY = event.clientY
    const startFrac = splitFrac
    const axis = editorSplit === 'v' ? 'x' : 'y'
    const rect = splitHostRef.current?.getBoundingClientRect()
    const size = (axis === 'x' ? rect?.width : rect?.height) ?? 1
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = editorSplit === 'v' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    const move = (next: PointerEvent): void => {
      const delta = axis === 'x' ? next.clientX - startX : next.clientY - startY
      setSplitFrac(Math.min(0.85, Math.max(0.15, startFrac + delta / size)))
    }
    const end = (): void => {
      try { handle.releasePointerCapture(pointerId) } catch { /* already released */ }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  /** Vim window ex-commands scoped to one tab (primary = activeId, split = splitId). */
  const vimOpsFor = (id: string | null): EditorVimOps => {
    const tab = id === null ? undefined : tabs.find(item => item.id === id)
    const tabDirty = tab?.kind === 'file' && buffers[tab.path] !== undefined
      && buffers[tab.path]!.draft !== buffers[tab.path]!.original
    return {
      save: () => id === null ? Promise.resolve(false) : saveTab(id),
      close: (force) => {
        if (id === null) return
        if (force) onClose(id)
        else requestClose(id)
      },
      closeAll: (force) => {
        if (force) onCloseMany(closableIds)
        else requestCloseMany(closableIds)
      },
      writeQuit: (force) => {
        void (async () => {
          // :x / :wq closes even a clean file — only a failed save blocks it.
          if (id === null) return
          if (tabDirty) {
            const ok = await saveTab(id)
            if (!ok) return
          }
          if (force) onClose(id)
          else requestClose(id)
        })()
      },
      vsplit: () => { openSplit('v') },
      hsplit: () => { openSplit('h') },
      only: () => { closeSplit() },
    }
  }

  const vimOps = vimOpsFor(active?.id ?? null)
  const splitTab = splitId === null ? undefined : tabs.find(tab => tab.id === splitId)
  const splitVimOps = vimOpsFor(splitId)

  useEffect(() => {
    if (!menuOpen && !addOpen && !newFileOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      setAddOpen(false)
      if (!newFileBusy) setNewFileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [addOpen, menuOpen, newFileBusy, newFileOpen])

  let body: ReactNode
  // 渲染期单趟计数：第 n 个 hunk 头行对应 diffHunks[n]（parseDiff 与 parseDiffHunks 同序）
  let hunkOrdinal = 0
  if (active?.kind === 'terminal') {
    body = (
      <TerminalView
        client={client}
        workspaceId={workspaceId}
        termId={termIdFromTabId(active.id)}
        injectComment={termSeed}
        t={t}
        aiOpen={aiTermIds?.includes(active.id) === true}
        onAiModeChange={(open) => { onAiModeChange?.(active.id, open) }}
        chromeHost={termChromeHost}
        onCleanExit={onTermCleanExit === undefined ? undefined : () => onTermCleanExit(active.id)}
      />
    )
  } else if (active?.kind === 'browser') {
    body = (
      <BrowserView
        tabId={active.id}
        onTitle={(title, url) => { onBrowserTitle?.(active.id, title, url) }}
        onOpenDevtools={() => { onOpenDevtools?.() }}
        onPick={(snapshot) => onPickBrowserEl?.(snapshot) === true}
        t={t}
      />
    )
  } else if (active === null) {
    body = (
      <div className={css.empty}>
        <p className={css.emptyTitle}>{t('editor.empty')}</p>
        <p className={css.emptyHint}>{t(terminalDocked === true ? 'editor.emptyHintDocked' : 'editor.emptyHint')}</p>
      </div>
    )
  } else if (active.kind === 'diff' || active.kind === 'commitDiff') {
    const rows = diffRows
    const binary = !diffLoading && isBinaryDiff(diffText)
    const newEmpty = diffNewEmpty
    const empty = !diffLoading && rows.length === 0 && !binary && !newEmpty
    const hint = diffLoading
      ? t('panel.loading')
      : binary
        ? t('diff.binary')
        : newEmpty
          ? t('diff.newEmpty')
          : empty
            ? t('diff.empty')
            : null
    const showRejectAll = rejectable && (diffHunks.length > 0 || newEmpty)
    body = (
      <div className={css.diffPane}>
        {diffTab !== null ? (
          <div className={css.diffActions}>
            {showRejectAll ? (
              <button
                type="button"
                className={css.diffAction}
                data-danger=""
                disabled={rejecting || diffLoading}
                onClick={rejectAllChanges}
              >
                {diffNewFile ? t('diff.rejectNewFile') : t('diff.rejectAll')}
              </button>
            ) : null}
            <button
              type="button"
              className={css.diffAction}
              disabled={diffLoading}
              onClick={refreshDiff}
            >
              {t('diff.refresh')}
            </button>
            {rejectNotice !== null ? (
              <span className={css.rejectNotice} data-kind={rejectNotice}>
                {t(`diff.rejectNotice.${rejectNotice}`)}
              </span>
            ) : null}
          </div>
        ) : null}
        {hint !== null ? <p className={css.diffHint}>{hint}</p> : null}
        {rows.length > 0 && !binary && !newEmpty ? (
          <pre className={css.diff}>
            {rows.map((row, index) => {
              // hunk 头行序号 → parseDiffHunks 的顺序对应；只有可撤销的未暂存 diff 才带按钮
              const hunk = row.kind === 'hunk' ? diffHunks[hunkOrdinal] : undefined
              if (row.kind === 'hunk') hunkOrdinal += 1
              return (
                <div key={`${index}:${row.text.slice(0, 24)}`} className={css.diffLine} data-kind={row.kind}>
                  {row.text === '' ? ' ' : row.text}
                  {row.kind === 'hunk' && rejectable && hunk !== undefined ? (
                    <button
                      type="button"
                      className={css.hunkReject}
                      disabled={rejecting}
                      title={t('diff.rejectHunk')}
                      onClick={() => {
                        setRejectNotice(null)
                        void rejectDiffHunks(new Set([hunk.index]))
                      }}
                    >
                      {t('diff.rejectHunk')}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </pre>
        ) : null}
      </div>
    )
  } else if (active.kind === 'preview') {
    body = (
      <FilePreview
        client={client}
        workspaceId={workspaceId}
        path={active.path}
        kind={active.preview ?? 'image'}
        t={t}
      />
    )
  } else if (buffer === undefined) {
    body = <p className={css.hint}>{t('panel.loading')}</p>
  } else {
    /** One CodeMirror editor bound to one tab's buffer and vim ops. */
    const editorOf = (tab: FileTab, buf: FileBuffer, ops: EditorVimOps): ReactNode => (
      <CodeEditor
        path={tab.path}
        value={buf.draft}
        label={fileName(tab.path)}
        mode={editorMode}
        t={t}
        onChange={(next) => { onDraft(tab.path, next) }}
        onSave={() => { void saveTab(tab.id) }}
        onAddToChat={onAddEditorToChat === undefined
          ? undefined
          : (text, kind) => addEditorToChat(tab.id, text, kind)}
        vimOps={ops}
      />
    )
    const primaryEditor = (() => {
      const editor = editorOf(active, buffer, vimOps)
      if (!markdownOpen) return editor
      return (
        <div className={css.mdShell} data-mode={mdMode}>
          {mdMode !== 'preview' ? <div className={css.mdEdit}>{editor}</div> : null}
          {mdMode !== 'edit' ? (
            <MarkdownPreview
              path={active.path}
              markdown={buffer.draft}
              onOpenFile={onOpenFile}
              t={t}
              workspaceId={workspaceId}
            />
          ) : null}
        </div>
      )
    })()
    if (editorSplit === 'none' || splitTab === undefined) {
      body = primaryEditor
    } else {
      const splitBuffer = buffers[splitTab.path]
      body = (
        <div
          ref={splitHostRef}
          className={css.editorSplit}
          data-split={editorSplit}
          style={{
            ['--git-editor-split-a' as string]: `${Math.round(splitFrac * 100)}%`,
            ['--git-editor-split-b' as string]: `${Math.round((1 - splitFrac) * 100)}%`,
          }}
        >
          <div className={css.splitPane} style={{ flexBasis: 'var(--git-editor-split-a)' }} onFocusCapture={() => { setSplitFocus('a') }}>
            {primaryEditor}
          </div>
          <div className={css.splitSashSlot}>
            {editorSplit === 'v' ? (
              <ColSash
                label={t('editor.splitResize')}
                onPointerDown={beginSplitResize}
                onReset={() => { setSplitFrac(0.5) }}
              />
            ) : (
              <RowSash
                label={t('editor.splitResize')}
                onPointerDown={beginSplitResize}
                onReset={() => { setSplitFrac(0.5) }}
              />
            )}
          </div>
          <div className={css.splitPane} style={{ flexBasis: 'var(--git-editor-split-b)' }} onFocusCapture={() => { setSplitFocus('b') }}>
            {splitBuffer === undefined
              ? <p className={css.hint}>{t('panel.loading')}</p>
              : editorOf(splitTab, splitBuffer, splitVimOps)}
          </div>
        </div>
      )
    }
  }

  const saveReason = workspaceId === undefined
    ? t('panel.noWorkspace')
    : saving
      ? t('editor.saveDisabledBusy')
      : !dirty
        ? t('editor.saveDisabledClean')
        : null

  const menuItem = (
    ids: string[],
    label: string,
    disabledReason: string,
  ) => (
    <button
      type="button"
      className={css.menuItem}
      role="menuitem"
      disabled={ids.length === 0}
      title={ids.length === 0 ? disabledReason : undefined}
      onClick={() => { setMenuOpen(false); requestCloseMany(ids) }}
    >
      {label}
    </button>
  )

  const ctxTab = tabMenu === null ? null : (tabs.find(tab => tab.id === tabMenu.tabId) ?? null)
  const ctxIndex = tabMenu === null ? -1 : tabs.findIndex(tab => tab.id === tabMenu.tabId)
  const ctxPinned = ctxTab?.kind === 'terminal' && ctxTab.id === TERMINAL_TAB_ID
  const ctxOthersIds = tabMenu === null ? [] : closableIds.filter(id => id !== tabMenu.tabId)
  const ctxLeftIds = ctxIndex > 0 ? tabs.slice(0, ctxIndex).filter(tab => tab.kind !== 'terminal').map(tab => tab.id) : []
  const ctxRightIds = ctxIndex >= 0 && ctxIndex < tabs.length - 1
    ? tabs.slice(ctxIndex + 1).filter(tab => tab.kind !== 'terminal').map(tab => tab.id)
    : []
  const tabCtxItems: ContextMenuEntry[] = tabMenu === null
    ? []
    : [
        {
          kind: 'item', id: 'close-tab',
          label: t('editor.closeTab', { name: ctxTab === null ? '' : tabLabelOf(ctxTab, t) }),
          disabled: ctxPinned,
          hint: t('editor.closeTabDisabled'),
          onClick: () => { requestClose(tabMenu.tabId) },
        },
        ...(ctxTab?.kind === 'file' && onAddEditorToChat !== undefined && buffers[ctxTab.path] !== undefined
          ? [
              { kind: 'item' as const, id: 'add-to-chat', icon: <IconChat />, label: t('editor.menu.addFileToChat'), onClick: () => { onAddEditorToChat({ text: buffers[ctxTab.path]!.draft, path: ctxTab.path, kind: 'file' as const }) } },
              { kind: 'sep' as const },
            ]
          : []),
        { kind: 'item', id: 'close-others', label: t('editor.closeOthers'), disabled: ctxOthersIds.length === 0, hint: t('editor.closeOthersDisabled'), onClick: () => { requestCloseMany(ctxOthersIds) } },
        { kind: 'item', id: 'close-all', label: t('editor.closeAll'), disabled: closableIds.length === 0, hint: t('editor.closeAllDisabled'), onClick: () => { requestCloseMany(closableIds) } },
        { kind: 'sep' },
        { kind: 'item', id: 'close-left', label: t('editor.closeLeft'), disabled: ctxLeftIds.length === 0, hint: t('editor.closeLeftDisabled'), onClick: () => { requestCloseMany(ctxLeftIds) } },
        { kind: 'item', id: 'close-right', label: t('editor.closeRight'), disabled: ctxRightIds.length === 0, hint: t('editor.closeRightDisabled'), onClick: () => { requestCloseMany(ctxRightIds) } },
      ]

  return (
    <section className={css.root} aria-label={active?.kind === 'terminal' ? t('term.title') : active?.kind === 'browser' ? t('browser.tab') : t('editor.empty')} data-git-ide-panel="editor">
      {leadingSash}
      <div className={css.main}>
        <div className={css.crumbRow}>
          <PathBreadcrumb
            client={client}
            workspaceId={workspaceId}
            workspaceTitle={workspaceTitle}
            active={active}
            onOpenFile={onOpenFile}
            t={t}
          />
          <div className={css.crumbActions}>
            {markdownOpen && active?.kind === 'file' ? (
              <span className={css.mdModes} role="group" aria-label={t('editor.mdPreview')}>
                <IconButton
                  label={t('editor.mdEdit')}
                  active={mdMode === 'edit'}
                  onClick={() => { setMdView(current => ({ ...current, [active.path]: 'edit' })) }}
                >
                  <IconEditor />
                </IconButton>
                <IconButton
                  label={t('editor.mdSplit')}
                  active={mdMode === 'split'}
                  onClick={() => { setMdView(current => ({ ...current, [active.path]: 'split' })) }}
                >
                  <IconSplit />
                </IconButton>
                <IconButton
                  label={t('editor.mdPreview')}
                  active={mdMode === 'preview'}
                  onClick={() => { setMdView(current => ({ ...current, [active.path]: 'preview' })) }}
                >
                  <IconEye />
                </IconButton>
              </span>
            ) : null}
            {active?.kind === 'file' && onAddEditorToChat !== undefined ? (
              <IconButton
                label={t('editor.menu.addFileToChat')}
                disabled={buffer === undefined}
                onClick={() => { if (buffer !== undefined && active !== null) addEditorToChat(active.id, buffer.draft, 'file') }}
              >
                <IconChat />
              </IconButton>
            ) : null}
            {active?.kind === 'file' ? (
              <IconButton
                label={saveReason ?? (dirty ? t('editor.save') : t('editor.saved'))}
                disabled={saveReason !== null}
                onClick={() => { void save() }}
              >
                <IconSave />
              </IconButton>
            ) : active?.kind === 'diff' || active?.kind === 'commitDiff' ? (
              <IconButton label={t('editor.fileTab')} onClick={() => { onOpenFile(active.path) }}>
                <IconDiff />
              </IconButton>
            ) : null}
            {editorSplit !== 'none' ? (
              <IconButton label={t('editor.unsplit')} onClick={closeSplit}>
                <IconSplit />
              </IconButton>
            ) : null}
            {onCollapse !== undefined ? (
              <IconButton label={t('ide.hideEditor')} onClick={onCollapse}>
                <IconPanelOff />
              </IconButton>
            ) : null}
          </div>
        </div>
        <div className={css.tabBar}>
          <div className={css.tabs} role="tablist">
            {tabs.map(tab => {
              const tabDirty = tab.kind === 'file' && buffers[tab.path] !== undefined
                && buffers[tab.path]!.draft !== buffers[tab.path]!.original
              const tabLabel = tabLabelOf(tab, t)
              // Split mode keeps one tab strip: the focused pane's tab is the
              // highlighted one; clicking a tab routes to the focused pane.
              const tabActiveId = editorSplit !== 'none' && splitFocus === 'b' ? splitId : activeId
              const activateTab = (): void => {
                if (editorSplit !== 'none' && splitFocus === 'b') {
                  // The second pane is a plain file view — no terminals etc.
                  if (tab.kind === 'file') setSplitId(tab.id)
                  return
                }
                onActivate(tab.id)
                setSplitFocus('a')
              }
              return (
                <div
                  key={tab.id}
                  className={css.tab}
                  data-active={tab.id === tabActiveId || undefined}
                  data-split-tab={editorSplit !== 'none' && tab.id === splitId ? '' : undefined}
                  data-ignored={tab.ignored === true || undefined}
                  role="tab"
                  aria-selected={tab.id === tabActiveId || undefined}
                  tabIndex={0}
                  title={tab.ignored === true ? t('tree.ignored') : undefined}
                  onClick={activateTab}
                  onContextMenu={(event) => { openTabMenu(event, tab.id) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      activateTab()
                    }
                  }}
                >
                  <span className={css.tabName}>{tabLabel}</span>
                  {tabDirty ? <span className={css.dirtyDot} title={t('editor.dirty')} /> : null}
                  {tab.kind === 'terminal' ? (
                    <span className={css.termMark} title={t('term.pinned')}><IconTerminal /></span>
                  ) : tab.kind === 'browser' ? (
                    <span className={css.termMark} title={t('browser.tab')}><IconGlobe /></span>
                  ) : null}
                  {tab.kind === 'terminal' && tab.id === TERMINAL_TAB_ID ? null : (
                    <IconButton
                      label={t('editor.close')}
                      onClick={(event) => { event.stopPropagation(); requestClose(tab.id) }}
                    >
                      <IconClose />
                    </IconButton>
                  )}
                </div>
              )
            })}
          </div>
          <div className={css.tabActions}>
            {onNewBrowser !== undefined ? (
              <IconButton label={t('editor.addBrowser')} onClick={onNewBrowser}>
                <IconGlobe />
              </IconButton>
            ) : null}
            <div className={css.menuWrap}>
              <IconButton
                label={t('editor.add')}
                active={addOpen}
                aria-haspopup="menu"
                aria-expanded={addOpen}
                onClick={() => { setAddOpen(open => !open); setMenuOpen(false); setTabMenu(null) }}
              >
                <IconPlus />
              </IconButton>
              {addOpen ? (
                <>
                  <div className={css.menuBackdrop} onClick={() => { setAddOpen(false) }} />
                  <div className={css.menu} role="menu" aria-label={t('editor.add')}>
                    <button
                      type="button"
                      className={css.menuItem}
                      role="menuitem"
                      onClick={() => {
                        setAddOpen(false)
                        onNewTerminal?.()
                      }}
                    >
                      {t('editor.addTerminal')}
                    </button>
                    {onNewBrowser !== undefined ? (
                      <button
                        type="button"
                        className={css.menuItem}
                        role="menuitem"
                        onClick={() => {
                          setAddOpen(false)
                          onNewBrowser()
                        }}
                      >
                        {t('editor.addBrowser')}
                      </button>
                    ) : null}
                    {onDockToBottom !== undefined ? (
                      <button
                        type="button"
                        className={css.menuItem}
                        role="menuitem"
                        onClick={() => {
                          setAddOpen(false)
                          onDockToBottom()
                        }}
                      >
                        {t('term.dockToBottom')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={css.menuItem}
                      role="menuitem"
                      disabled={workspaceId === undefined || onCreateFile === undefined}
                      title={workspaceId === undefined ? t('editor.addFileNoWorkspace') : undefined}
                      onClick={() => {
                        setAddOpen(false)
                        setNewFileDir(suggestNewFileDir(active?.path, active?.kind))
                        setNewFileName('未命名.txt')
                        setNewFileError(null)
                        setNewFileOpen(true)
                      }}
                    >
                      {t('editor.addFile')}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <div className={css.menuWrap}>
              <IconButton
                label={t('editor.tabsMenu')}
                active={menuOpen}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => { setMenuOpen(open => !open); setAddOpen(false); setTabMenu(null) }}
              >
                <IconMore />
              </IconButton>
              {menuOpen ? (
                <>
                  <div className={css.menuBackdrop} onClick={() => { setMenuOpen(false) }} />
                  <div className={css.menu} role="menu" aria-label={t('editor.tabsMenu')}>
                    {menuItem(closeAllIds, t('editor.closeAll'), t('editor.closeAllDisabled'))}
                    {menuItem(closeOthersIds, t('editor.closeOthers'), t('editor.closeOthersDisabled'))}
                    {menuItem(closeLeftIds, t('editor.closeLeft'), t('editor.closeLeftDisabled'))}
                    {menuItem(closeRightIds, t('editor.closeRight'), t('editor.closeRightDisabled'))}
                  </div>
                </>
              ) : null}
            </div>
            {active?.kind === 'terminal' ? (
              <span className={css.termChrome} ref={setTermChromeHost} />
            ) : null}
          </div>
        </div>
        <div className={css.body}>
          {error !== null || notice != null ? (
            <div className={css.banner}>
              <div>{(error ?? notice)!.messageZh}</div>
              <div>{(error ?? notice)!.hintZh}</div>
            </div>
          ) : null}
          {body}
          {/* ★ fork 定制：非激活 browser tab 隐藏常驻堆（2026-09-04 每会话独立浏览器 tab）。
              BrowserView 只在激活 tab 渲染 iframe → 后台会话无 iframe 可操作、页面状态不保持。
              这里把所有非激活 browser tab 的 BrowserView 挂到 display:none 容器里常驻：
              隐藏不销毁，iframe 存活、postMessage 可达、页面状态保留。active 是 browser 时
              已由 body 渲染，这里排除避免同 tabId 双挂载（重复订阅/message 双处理）。 */}
          {tabs.filter(t => t.kind === 'browser' && t.id !== (active?.kind === 'browser' ? active.id : '')).map(tab => (
            <div key={tab.id} className={css.hiddenPane} aria-hidden="true">
              <BrowserView
                tabId={tab.id}
                onTitle={(title, url) => { onBrowserTitle?.(tab.id, title, url) }}
                onOpenDevtools={() => { onOpenDevtools?.() }}
                onPick={(snapshot) => onPickBrowserEl?.(snapshot) === true}
                t={t}
              />
            </div>
          ))}
          {newFileOpen ? (
            <div className={css.dialogMask}>
              <div className={css.dialog} role="dialog" aria-labelledby="git-new-file-title">
                <h2 id="git-new-file-title">{t('editor.addFileTitle')}</h2>
                <p>{t('editor.addFileHint')}</p>
                <label className={css.field}>
                  <span>{t('editor.addFileDir')}</span>
                  <input
                    className={css.fieldInput}
                    value={newFileDir}
                    placeholder={t('editor.addFileDirRoot')}
                    onChange={(event) => { setNewFileDir(event.target.value); setNewFileError(null) }}
                  />
                </label>
                <label className={css.field}>
                  <span>{t('editor.addFileName')}</span>
                  <input
                    className={css.fieldInput}
                    value={newFileName}
                    autoFocus
                    onChange={(event) => { setNewFileName(event.target.value); setNewFileError(null) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void submitNewFile()
                      }
                    }}
                  />
                </label>
                {newFileError !== null ? <p className={css.fieldError}>{newFileError}</p> : null}
                <div className={css.dialogRow}>
                  <button type="button" className={css.keep} onClick={() => { setNewFileOpen(false) }}>
                    {t('editor.addFileCancel')}
                  </button>
                  <button
                    type="button"
                    className={css.create}
                    disabled={newFileBusy}
                    onClick={() => { void submitNewFile() }}
                  >
                    {t('editor.addFileCreate')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {pendingClose !== null ? (
            <div className={css.dialogMask}>
              <div className={css.dialog} role="dialog" aria-labelledby="git-close-title">
                <h2 id="git-close-title">{t('editor.closeDirtyTitle')}</h2>
                <p>
                  {pendingClose.names.length === 1
                    ? t('editor.closeDirtyBody', { name: pendingClose.names[0]! })
                    : t('editor.closeDirtyBatchBody', { count: pendingClose.names.length })}
                </p>
                <div className={css.dialogRow}>
                  <button type="button" className={css.keep} onClick={() => { setPendingClose(null) }}>
                    {t('editor.keep')}
                  </button>
                  <button
                    type="button"
                    className={css.discard}
                    onClick={() => {
                      const ids = pendingClose.ids
                      setPendingClose(null)
                      onCloseMany(ids)
                    }}
                  >
                    {t('editor.discard')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {staleConflict !== null ? (
            <div className={css.dialogMask}>
              <div className={css.dialog} role="dialog" aria-labelledby="git-stale-title">
                <h2 id="git-stale-title">{t('editor.staleTitle')}</h2>
                <p>{t('editor.staleBody', { name: fileName(staleConflict.path) })}</p>
                <p>{t('editor.staleHint')}</p>
                <div className={css.dialogRow}>
                  <button type="button" className={css.keep} onClick={() => { setStaleConflict(null) }}>
                    {t('editor.staleCancel')}
                  </button>
                  <button
                    type="button"
                    className={css.discard}
                    onClick={() => {
                      const path = staleConflict.path
                      setStaleConflict(null)
                      onReload?.(path)
                    }}
                  >
                    {t('editor.staleReload')}
                  </button>
                  <button
                    type="button"
                    className={css.create}
                    onClick={() => {
                      const id = staleConflict.id
                      setStaleConflict(null)
                      void saveTab(id, true)
                    }}
                  >
                    {t('editor.staleOverwrite')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {pendingDelete !== null ? (
            <div className={css.dialogMask}>
              <div className={css.dialog} role="dialog" aria-labelledby="git-reject-delete-title">
                <h2 id="git-reject-delete-title">{t('diff.confirmDeleteTitle')}</h2>
                <p>{t('diff.confirmDeleteBody', { name: fileName(pendingDelete) })}</p>
                <div className={css.dialogRow}>
                  <button type="button" className={css.keep} onClick={() => { setPendingDelete(null) }}>
                    {t('diff.confirmDeleteCancel')}
                  </button>
                  <button
                    type="button"
                    className={css.discard}
                    onClick={() => { void confirmDeleteNewFile() }}
                  >
                    {t('diff.confirmDeleteOk')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {tabMenu !== null ? (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabCtxItems}
          ariaLabel={t('editor.tabMenu')}
          onClose={() => { setTabMenu(null) }}
        />
      ) : null}
    </section>
  )
}