import type { Context } from '@deepseek-ai/cordis'
import { madaziAccessMap } from './sandbox-clamp.ts'

interface SessionCandidate {
  sessionId: string
  cwd?: string
}

interface AgentLike {
  id?: string
  session?: { header?: { cwd?: string } }
}

type ListCandidates = (agent: AgentLike, query?: string, limit?: number, signal?: AbortSignal) => Promise<SessionCandidate[]>

/** 从平台项目路径解析项目 id（/app/generated/<uuid> 形态）。 */
const pidFromPath = (p?: string): string | null => {
  if (!p) return null
  const m = String(p).match(/generated\/([0-9a-fA-F-]{36})/)
  return m ? m[1] : null
}

/**
 * @ 会话候选过滤（2026-09-05）。
 *
 * 官方链路：@ 触发源 → RPC sessionReferenceResolver.candidates → listCandidates
 * → sessionQuery.listSessions（完整 corpus：dsh 共享单实例，含所有用户/项目的会话）。
 * 两层泄漏：① 归档会话仍出现（workspaceRegistry.archivedSessionIds 与列表层不通气）；
 * ② 无权限项目的会话全量下发（candidates 不在网关 session/list 过滤拦截内）。
 *
 * host 侧 wrap：实例属性遮蔽 listCandidates（RPC 面 remoteExportCandidates 以
 * this.listCandidates 调用，实例补丁可拦截）。
 *   1) 归档过滤：剔除 archivedSessionIds 集合内的会话；
 *   2) 权限过滤：只保留「发起会话归属用户有权限的项目」内的会话（复用 sandbox-clamp
 *      的 madaziAccessMap——会话→权限根，已按活跃操作者计算，与沙箱 clamp 同源一致）。
 *      无权限根（新会话/平台不可达）→ fail-closed 只显示发起会话自身项目。
 *      非平台目录会话（普通 workspace）保留。
 */
export function registerSessionRefArchiveFilter(ctx: Context): () => void {
  const resolver = ctx.get('sessionReferenceResolver') as { listCandidates: ListCandidates } | undefined
  const registry = ctx.get('workspaceRegistry') as { archivedSessionIds?: readonly string[] } | undefined
  if (resolver === undefined || registry === undefined) return () => {}
  const orig = resolver.listCandidates.bind(resolver)
  resolver.listCandidates = async (agent, query = '', limit, signal) => {
    const result = await orig(agent, query, limit, signal)
    // ★ 诊断（2026-09-05）：@候选过滤实测——确认 agent.id / roots / 过滤前后数量
    console.log('[session-ref] candidates:', {
      agentId: agent?.id,
      agentCwd: agent?.session?.header?.cwd,
      total: result.length,
      archived: (registry.archivedSessionIds ?? []).length,
    })

    // ── 归档过滤 ──
    let archived: readonly string[] = []
    try { archived = registry.archivedSessionIds ?? [] } catch { /* registry 未就绪时不过滤 */ }
    const hiddenSet = new Set(archived)
    // ★ 诊断：归档集合具体 id + 过滤前 7d473089 的会话归档状态
    console.log('[session-ref] archived ids:', JSON.stringify(archived.map((x) => String(x).slice(0, 20))))
    console.log('[session-ref] pre pid-7d473089:', JSON.stringify(result
      .filter((c) => (c.cwd ?? '').includes('7d473089'))
      .map((c) => ({ id: c.sessionId.slice(0, 16), arch: hiddenSet.has(c.sessionId) }))))
    let visible = archived.length === 0 ? result : result.filter((c) => !hiddenSet.has(c.sessionId))

    // ── 权限过滤（复用 sandbox-clamp 的 madaziAccessMap）──
    if (madaziAccessMap.size > 0) {
      let allowed: Set<string> | null = null
      const myRoots = agent?.id != null ? madaziAccessMap.get(agent.id) : undefined
      if (myRoots !== undefined && myRoots.length > 0) {
        allowed = new Set()
        for (const r of myRoots) { const p = pidFromPath(r); if (p) allowed.add(p) }
      }
      if (allowed === null || allowed.size === 0) {
        // fail-closed：无权限根 → 只显示发起会话自身项目
        const p = pidFromPath(agent?.session?.header?.cwd)
        allowed = p ? new Set([p]) : new Set<string>()
      }
      visible = visible.filter((c) => {
        const p = pidFromPath(c.cwd)
        if (p === null) return true // 非平台目录会话（普通 workspace）
        return allowed!.has(p)
      })
      console.log('[session-ref] 过滤后:', { visible: visible.length, allowed: allowed.size })
      console.log('[session-ref] 明细:', JSON.stringify(visible.map((c) => ({
        id: c.sessionId.slice(0, 20),
        cwd: (c.cwd ?? '').slice(-48),
        archived: hiddenSet.has(c.sessionId),
      })), null, 0))
    }
    return visible
  }
  return () => { resolver.listCandidates = orig }
}
