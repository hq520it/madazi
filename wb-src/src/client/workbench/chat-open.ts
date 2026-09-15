/**
 * fork 定制：聊天侧文件点击改道工作台编辑器。
 *
 * 官方链路（dsh-client-ui-conversation 注入的 openFile）：
 *   产物 chip / 工具行文件 / 结束语 mention → workspaces.openPath
 *   → host.openPath RPC → dsh-host-apiproxy openNativePath → xdg-open。
 * 该链路只适用于 dsh web 跑在用户本机桌面的场景；madazi 的 dsh-web 在
 * 无桌面的 k3s 容器里，spawn xdg-open 必然 ENOENT（报错
 * "path open failed: path open failed: spawn xdg-open ENOENT"）。
 *
 * 这里包装 client 侧 workspaces.openPath：目标路径能映射到已注册工作区、
 * 且工作台已挂载（存在订阅者）时改派给工作台（编辑器 tab / 文件树侧栏），
 * 不再发起注定失败的 host RPC；否则回落官方原实现。
 */

export interface ChatOpenRequest {
  readonly workspaceId: string
  /** 工作区相对路径；'' 表示工作区根目录（showInFolder 语义）。 */
  readonly relPath: string
}

export type ChatOpenListener = (request: ChatOpenRequest) => void

const listeners = new Set<ChatOpenListener>()

/** 工作台挂载后订阅聊天文件点击；返回退订函数。 */
export function subscribeChatOpen(listener: ChatOpenListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

interface WorkspaceRootLike {
  readonly workspaceId: string
  readonly path: string
}

interface WorkspacesLike {
  openPath(path: string): Promise<void>
  readonly list?: { getSnapshot?: () => { items?: readonly WorkspaceRootLike[] } }
}

export interface ChatOpenContext {
  effect(fn: () => (() => void) | void, label?: string): void
  readonly workspaces?: WorkspacesLike
}

function trimTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, '')
}

/**
 * 绝对路径 → {workspaceId, relPath}。取最长前缀命中，避免嵌套工作区误配；
 * 恰好等于根目录时 relPath 为 ''（目录语义）。非绝对路径不匹配。
 */
export function matchWorkspaceRoot(
  items: readonly WorkspaceRootLike[],
  target: string,
): ChatOpenRequest | undefined {
  const abs = trimTrailingSlashes(target)
  if (abs === '' || !abs.startsWith('/')) return undefined
  let best: ChatOpenRequest | undefined
  let bestRootLen = -1
  for (const item of items) {
    if (typeof item.workspaceId !== 'string' || typeof item.path !== 'string') continue
    const root = trimTrailingSlashes(item.path)
    if (root === '' || !root.startsWith('/')) continue
    let rel: string
    if (abs === root) rel = ''
    else if (abs.startsWith(`${root}/`)) rel = abs.slice(root.length + 1)
    else continue
    if (root.length > bestRootLen) {
      best = { workspaceId: item.workspaceId, relPath: rel }
      bestRootLen = root.length
    }
  }
  return best
}

/** 包装 workspaces.openPath：可映射且工作台在线 → 本地分发；否则回落官方。 */
export function installChatOpenClient(ctx: ChatOpenContext): void {
  const workspaces = ctx.workspaces
  if (workspaces === undefined || typeof workspaces.openPath !== 'function') return
  ctx.effect(() => {
    const original = workspaces.openPath
    const wrapped = (path: string): Promise<void> => {
      const items = workspaces.list?.getSnapshot?.().items
      const match = Array.isArray(items) ? matchWorkspaceRoot(items, path) : undefined
      if (match === undefined || listeners.size === 0) return original.call(workspaces, path)
      for (const listener of listeners) listener(match)
      return Promise.resolve()
    }
    workspaces.openPath = wrapped
    return () => {
      if (workspaces.openPath === wrapped) workspaces.openPath = original
    }
  }, 'ui-workbench: chat file open')
}
