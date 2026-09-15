/**
 * 数据库管理面板（工作台侧栏「数据库」标签）v2
 * 三视图：数据表（结构浏览器）/ 关系图（SVG ER 图）/ SQL（只读查询）
 * 数据链路：/api/projects/:id/db/* → madazi-server → preview Pod 内 psql。
 * ★ 平台项目 id 从 workspacePath 提取（/app/generated/<projectId>）——workspaceId 是
 *   dsh 内部 id，与平台 project id 不是一回事。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import css from './DatabasePanel.module.css'

interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default: string | null
  pk: boolean
}
interface TableInfo {
  name: string
  comment: string
  estRows: number
  columns: ColumnInfo[]
}
interface RelationInfo {
  name: string
  fromTable: string
  fromColumns: string[]
  toTable: string
  toColumns: string[]
}
interface Schema {
  tables: TableInfo[]
  relations: RelationInfo[]
}
interface QueryResult {
  columns: string[]
  rows: string[][]
}
interface TableData {
  table: string
  count: number
  columns: string[]
  rows: string[][]
  page: number
  pageSize: number
  sortCol: string
  sortDir: 'ASC' | 'DESC'
}

type View = 'tables' | 'er' | 'sql'

// ── ER 布局常量 ─────────────────────────────────────────────
const NODE_W = 170
const ROW_H = 20
const HEADER_H = 42
const H_GAP = 60
const V_GAP = 22

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

// 外键列集合（"表.列"），供表浏览器 / ER 图标记 FK 列
function buildFkSet(schema: Schema | null): Set<string> {
  const s = new Set<string>()
  if (schema) {
    for (const r of schema.relations) {
      for (const c of r.fromColumns) s.add(`${r.fromTable}.${c}`)
    }
  }
  return s
}

function layoutER(schema: Schema) {
  const { tables, relations } = schema
  if (tables.length === 0) return null
  const tableSet = new Set(tables.map((t) => t.name))
  const inScope = relations.filter((r) => tableSet.has(r.fromTable) && tableSet.has(r.toTable))
  // 层 = 最长依赖链深度：被引用表（父）层小，引用表（子）层大 → 图从左到右展开
  const layer = new Map<string, number>()
  for (const t of tables) layer.set(t.name, 0)
  for (let i = 0; i < tables.length; i++) {
    let changed = false
    for (const r of inScope) {
      const want = (layer.get(r.toTable) ?? 0) + 1
      if ((layer.get(r.fromTable) ?? 0) < want) {
        layer.set(r.fromTable, want)
        changed = true
      }
    }
    if (!changed) break
  }
  const byLayer = new Map<number, TableInfo[]>()
  for (const t of tables) {
    const l = layer.get(t.name) ?? 0
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(t)
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b)
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>()
  let maxX = 0
  let maxY = 0
  for (const l of layers) {
    const items = byLayer.get(l)!.slice().sort((a, b) => a.name.localeCompare(b.name))
    let y = 0
    for (const t of items) {
      const h = HEADER_H + Math.max(t.columns.length, 1) * ROW_H
      const x = l * (NODE_W + H_GAP)
      pos.set(t.name, { x, y, w: NODE_W, h })
      y += h + V_GAP
      maxX = Math.max(maxX, x + NODE_W)
      maxY = Math.max(maxY, y)
    }
  }
  return { pos, maxX, maxY }
}

// 表内某列的 Y 中心
function colY(t: TableInfo, colName: string): number {
  const idx = t.columns.findIndex((c) => c.name === colName)
  return HEADER_H + (idx < 0 ? 0 : idx) * ROW_H + ROW_H / 2
}

function KeyIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" className={css.erIcon}>
      <circle cx="4" cy="6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 6 L10 6 M10 4.6 L10 7.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" className={css.erIcon}>
      <circle cx="3" cy="6" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9" cy="6" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.8 6 L7.2 6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

// 结果表格（SQL 视图 + 表数据预览共用）
function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className={css.resultWrap}>
      <table className={css.result}>
        <thead>
          <tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.length === 0
            ? <tr><td colSpan={result.columns.length || 1}>（空）</td></tr>
            : result.rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

// 表数据浏览器（分页 + 列排序 + 真实行数）v2
function DataBrowser({
  data, loading, onNav, onSort, onClose,
}: {
  data: TableData
  loading: boolean
  onNav: (page: number) => void
  onSort: (col: string, dir: 'ASC' | 'DESC') => void
  onClose: () => void
}) {
  const totalPages = Math.max(1, Math.ceil(data.count / (data.pageSize || 1)))
  const handleSort = (col: string) => {
    const dir = data.sortCol === col && data.sortDir === 'ASC' ? 'DESC' : 'ASC'
    onSort(col, dir)
  }
  return (
    <div className={css.dataPreview}>
      <div className={css.toolbar}>
        <span className={css.title}>
          {data.table} <span className={css.dataCount}>{formatCount(data.count)} 行</span>
        </span>
        <button type="button" className={css.action} onClick={onClose}>关闭</button>
      </div>
      <div className={css.dataNav}>
        <span className={css.dataPage}>第 {data.page} / {totalPages} 页</span>
        <span className={css.dataNavBtns}>
          <button type="button" className={css.action} disabled={loading || data.page <= 1} onClick={() => onNav(data.page - 1)}>‹ 上一页</button>
          <button type="button" className={css.action} disabled={loading || data.page >= totalPages} onClick={() => onNav(data.page + 1)}>下一页 ›</button>
        </span>
      </div>
      <div className={css.resultWrap}>
        <table className={css.result}>
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c}>
                  <button type="button" className={css.thSort} onClick={() => handleSort(c)} title="点击排序">
                    {c}
                    {data.sortCol === c
                      ? <span className={css.sortArrow}>{data.sortDir === 'ASC' ? '▲' : '▼'}</span>
                      : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0
              ? <tr><td colSpan={data.columns.length || 1}>（空）</td></tr>
              : data.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} title={v}>{v}</td>)}</tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 关系图（SVG ER）：分层布局 + 外键连线
function ErDiagram({ schema }: { schema: Schema }) {
  const layout = useMemo(() => layoutER(schema), [schema])
  const fkSet = useMemo(() => buildFkSet(schema), [schema])
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!layout) return
    const el = wrapRef.current
    if (!el) return
    const fit = Math.min(1, Math.max(0.35, (el.clientWidth - 16) / Math.max(layout.maxX, 1)))
    setScale(fit)
  }, [layout])

  if (!layout) return <div className={css.hint}>暂无数据表（需先启动预览）</div>
  const { pos, maxX, maxY } = layout

  return (
    <div className={css.erWrap} ref={wrapRef}>
      <div className={css.erToolbar}>
        <span className={css.erCount}>
          {schema.tables.length} 表 / {schema.relations.length} 外键
        </span>
        <span className={css.erZoom}>
          <button type="button" className={css.erBtn} onClick={() => setScale((s) => Math.max(0.35, s * 0.8))} title="缩小">−</button>
          <span className={css.erPct}>{Math.round(scale * 100)}%</span>
          <button type="button" className={css.erBtn} onClick={() => setScale((s) => Math.min(2, s * 1.25))} title="放大">+</button>
        </span>
      </div>
      <div className={css.erScroll}>
        <svg width={Math.max(maxX * scale, 1)} height={Math.max(maxY * scale, 1)} className={css.erSvg}>
          <defs>
            <marker id="dswDbArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={css.erArrow} />
            </marker>
          </defs>
          <g transform={`scale(${scale})`}>
            {schema.relations.map((r, i) => {
              const from = pos.get(r.fromTable)
              const to = pos.get(r.toTable)
              const fromT = schema.tables.find((t) => t.name === r.fromTable)
              const toT = schema.tables.find((t) => t.name === r.toTable)
              if (!from || !to || !fromT || !toT) return null
              const x1 = from.x + from.w
              const y1 = from.y + colY(fromT, r.fromColumns[0] ?? '')
              const x2 = to.x
              const y2 = to.y + colY(toT, r.toColumns[0] ?? '')
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} L ${x2} ${y2}`}
                  className={css.erEdge}
                  markerEnd="url(#dswDbArrow)"
                >
                  <title>{`${r.fromTable}.${r.fromColumns.join(',')} → ${r.toTable}.${r.toColumns.join(',')}`}</title>
                </path>
              )
            })}
            {schema.tables.map((t) => {
              const p = pos.get(t.name)
              if (!p) return null
              return (
                <g key={t.name} transform={`translate(${p.x}, ${p.y})`} className={css.erNode}>
                  <rect width={p.w} height={p.h} rx={5} className={css.erNodeBody} />
                  <rect width={p.w} height={HEADER_H} rx={5} className={css.erNodeHead} />
                  <text x={8} y={15} className={css.erNodeTitle}>{t.name}</text>
                  {t.comment ? (
                    <text x={8} y={32} className={css.erNodeComment}>{t.comment.length > 24 ? `${t.comment.slice(0, 24)}…` : t.comment}</text>
                  ) : null}
                  <text x={p.w - 8} y={15} textAnchor="end" className={css.erNodeMeta}>{formatCount(t.estRows)}</text>
                  {t.columns.map((c, i) => {
                    const y = HEADER_H + i * ROW_H
                    const isFk = fkSet.has(`${t.name}.${c.name}`)
                    return (
                      <g key={c.name}>
                        <line x1={4} x2={p.w - 4} y1={y} y2={y} className={css.erRowLine} />
                        <g transform={`translate(8, ${y + ROW_H / 2 - 5})`}>
                          {c.pk ? <KeyIcon /> : isFk ? <LinkIcon /> : null}
                        </g>
                        <text x={22} y={y + ROW_H / 2 + 3} className={c.pk ? css.erPk : css.erCol}>
                          {c.name}
                        </text>
                        <text x={p.w - 8} y={y + ROW_H / 2 + 3} textAnchor="end" className={css.erType}>{c.type}</text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}

export function DatabasePanel({ workspacePath }: { workspacePath?: string }) {
  const [view, setView] = useState<View>('tables')
  const [schema, setSchema] = useState<Schema | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tableData, setTableData] = useState<TableData | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [sqlLoading, setSqlLoading] = useState(false)
  const [sqlHistory, setSqlHistory] = useState<string[]>([])
  const [elapsed, setElapsed] = useState<number | null>(null)
  // ★ 多项目预览：DB 面板按项目切换（可多开预览，需选连哪个库）
  const [projects, setProjects] = useState<Array<{ projectId: string; name: string | null }>>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  const match = workspacePath && workspacePath.match(/\/generated\/([0-9a-fA-F-]{36})/)
  const workspaceProjectId = match ? match[1] : undefined
  const [selProject, setSelProject] = useState<string>(workspaceProjectId || '')
  const api = (suffix: string) => `/api/projects/${selProject}${suffix}`
  const fkSet = useMemo(() => buildFkSet(schema), [schema])

  // 初始化：默认当前工作区项目；并拉运行中预览列表（供右上角切换）
  useEffect(() => {
    if (workspaceProjectId) setSelProject(workspaceProjectId)
    let cancelled = false
    fetch('/api/projects/previews/running')
      .then((r) => r.json())
      .then((d: { running?: Array<{ projectId?: string; name?: string | null }> }) => {
        if (cancelled) return
        const running = (d?.running || [])
          .filter((x) => x.projectId)
          .map((x) => ({ projectId: x.projectId as string, name: x.name || null }))
        setProjects(running)
        setProjectsLoaded(true)
        // 当前工作区项目没在跑 → 落到第一个运行中的预览
        setSelProject((prev) => (running.some((p) => p.projectId === prev) ? prev : (running[0]?.projectId || prev)))
      })
      .catch(() => { if (!cancelled) setProjectsLoaded(true) })
    return () => { cancelled = true }
  }, [workspaceProjectId])

  const loadSchema = async () => {
    if (!selProject) return
    setSchemaLoading(true)
    setError(null)
    try {
      const res = await fetch(api('/db/schema'))
      const data = await res.json() as { ok?: boolean; schema?: Schema; error?: string }
      if (data.ok) setSchema(data.schema ?? { tables: [], relations: [] })
      else setError(data.error ?? '加载 schema 失败')
    } catch (e) {
      setError(String(e))
    } finally {
      setSchemaLoading(false)
    }
  }

  // 切项目/初始化后重载 schema
  useEffect(() => { if (selProject) void loadSchema() }, [selProject])

  const runQuery = async (query: string) => {
    const q = query.trim()
    if (!selProject || !q) return
    setSqlLoading(true)
    setError(null)
    const t0 = performance.now()
    try {
      const res = await fetch(api('/db/query'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: q }),
      })
      const data = await res.json() as { ok?: boolean; columns?: string[]; rows?: string[][]; error?: string }
      if (data.ok) {
        setResult({ columns: data.columns ?? [], rows: data.rows ?? [] })
        setElapsed(performance.now() - t0)
        setSqlHistory((prev) => [q, ...prev.filter((h) => h !== q)].slice(0, 10))
      } else {
        setError(data.error ?? '查询失败')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSqlLoading(false)
    }
  }

  // 表数据浏览：分页 + 列排序 + 真实行数
  const loadTableData = async (table: string, page: number, sortCol: string, sortDir: 'ASC' | 'DESC') => {
    if (!selProject) return
    setDataLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ table, page: String(page), pageSize: '50', sortCol, sortDir })
      const res = await fetch(`${api('/db/table-data')}?${params.toString()}`)
      const data = await res.json() as { ok?: boolean; error?: string } & TableData
      if (data.ok) setTableData(data)
      else setError(data.error ?? '加载表数据失败')
    } catch (e) {
      setError(String(e))
    } finally {
      setDataLoading(false)
    }
  }

  const openTable = (name: string) => void loadTableData(name, 1, '', 'ASC')
  const navPage = (page: number) => {
    if (tableData) void loadTableData(tableData.table, page, tableData.sortCol, tableData.sortDir)
  }
  const sortBy = (col: string, dir: 'ASC' | 'DESC') => {
    if (tableData) void loadTableData(tableData.table, 1, col, dir)
  }

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (!selProject) {
    return <div className={css.hint}>{projectsLoaded ? '暂无运行中的预览（需先启动预览）' : '加载中…'}</div>
  }

  // 切换下拉选项：运行中的预览项目；若当前选中不在列表（如拉取失败），补一个兜底项
  const projectOptions = projects.some((p) => p.projectId === selProject)
    ? projects
    : [{ projectId: selProject, name: selProject.slice(0, 8) }, ...projects]

  return (
    <div className={css.root}>
      <div className={css.tabs}>
        <button
          type="button"
          className={`${css.tab} ${view === 'tables' ? css.tabActive : ''}`}
          onClick={() => setView('tables')}
        >
          数据表
        </button>
        <button
          type="button"
          className={`${css.tab} ${view === 'er' ? css.tabActive : ''}`}
          onClick={() => setView('er')}
        >
          关系图
        </button>
        <button
          type="button"
          className={`${css.tab} ${view === 'sql' ? css.tabActive : ''}`}
          onClick={() => setView('sql')}
        >
          SQL
        </button>
        <span className={css.tabSpacer} />
        <select
          className={css.projectSelect}
          value={selProject}
          title="切换项目数据库"
          onChange={(e) => {
            setSelProject(e.target.value)
            setSchema(null)
            setTableData(null)
            setResult(null)
            setExpanded(new Set())
            setElapsed(null)
          }}
        >
          {projectOptions.map((p) => (
            <option key={p.projectId} value={p.projectId}>
              {p.name || p.projectId.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      {error ? <pre className={css.error}>{error}</pre> : null}

      {view === 'tables' && (
        <div className={css.tablesView}>
          <div className={css.toolbar}>
            <span className={css.title}>数据表</span>
            <button type="button" className={css.action} onClick={() => void loadSchema()} disabled={schemaLoading}>
              {schemaLoading ? '加载中…' : '刷新'}
            </button>
          </div>
          {!schema
            ? <div className={css.hint}>{schemaLoading ? '加载中…' : ''}</div>
            : schema.tables.length === 0
              ? <div className={css.hint}>暂无数据表（需先启动预览）</div>
              : (
                <div className={css.tableList}>
                  {schema.tables.map((t) => {
                    const isOpen = expanded.has(t.name)
                    return (
                      <div key={t.name} className={css.tCard}>
                        <button type="button" className={css.tHead} onClick={() => toggleExpand(t.name)}>
                          <span className={css.tName}>{t.name}</span>
                          <span className={css.tMeta}>{formatCount(t.estRows)} 行</span>
                        </button>
                        {isOpen && (
                          <div className={css.tBody}>
                            <table className={css.colTable}>
                              <thead>
                                <tr>
                                  <th>列</th><th>类型</th><th>可空</th><th>默认</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.columns.length === 0
                                  ? <tr><td colSpan={4}>（无列）</td></tr>
                                  : t.columns.map((c) => (
                                    <tr key={c.name}>
                                      <td>
                                        {c.pk
                                          ? <span className={css.chipPk}>PK</span>
                                          : fkSet.has(`${t.name}.${c.name}`)
                                            ? <span className={css.chipFk}>FK</span>
                                            : null}
                                        <span className={c.pk ? css.pkName : undefined}>{c.name}</span>
                                      </td>
                                      <td className={css.colType}>{c.type}</td>
                                      <td>{c.nullable ? '✓' : '—'}</td>
                                      <td className={css.colDefault}>{c.default ?? ''}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                            <div className={css.tActions}>
                              <button
                                type="button"
                                className={css.action}
                                onClick={() => openTable(t.name)}
                                disabled={dataLoading}
                              >
                                {dataLoading ? '加载中…' : '查看数据'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
          {tableData ? (
            <DataBrowser
              data={tableData}
              loading={dataLoading}
              onNav={navPage}
              onSort={sortBy}
              onClose={() => setTableData(null)}
            />
          ) : null}
        </div>
      )}

      {view === 'er' && (
        schema
          ? <ErDiagram schema={schema} />
          : <div className={css.hint}>{schemaLoading ? '加载中…' : '暂无数据'}</div>
      )}

      {view === 'sql' && (
        <div className={css.sqlView}>
          <textarea
            className={css.sql}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              // Tab → 插入两个空格；Cmd/Ctrl+Enter → 执行
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget
                const s = el.selectionStart ?? sql.length
                const v = `${sql.slice(0, s)}  ${sql.slice(el.selectionEnd ?? s)}`
                setSql(v)
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 })
              } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void runQuery(sql)
              }
            }}
            placeholder={'只读 SQL，如 SELECT * FROM items（Cmd/Ctrl+Enter 执行）'}
            rows={3}
            spellCheck={false}
          />
          <div className={css.sqlBar}>
            <button type="button" className={css.action} onClick={() => void runQuery(sql)} disabled={sqlLoading}>
              {sqlLoading ? '执行中…' : '执行 SQL'}
            </button>
            {elapsed !== null ? <span className={css.sqlMeta}>耗时 {Math.round(elapsed)}ms</span> : null}
          </div>
          {sqlHistory.length > 0 ? (
            <div className={css.history}>
              {sqlHistory.map((h, i) => (
                <button key={i} type="button" className={css.historyItem} onClick={() => setSql(h)} title={h}>
                  {h}
                </button>
              ))}
            </div>
          ) : null}
          {result ? <ResultTable result={result} /> : null}
        </div>
      )}
    </div>
  )
}
