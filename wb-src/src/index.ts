import type { Context } from '@deepseek-ai/cordis'
import { GitService } from './host/git-service.ts'
import { registerGitHttp } from './host/http.ts'
import { registerGitTools } from './host/tools.ts'
import { registerBrowserAgent } from './host/browser-agent.ts'
import { registerSessionRefArchiveFilter } from './host/session-ref-archive.ts'
import { registerSandboxClamp } from './host/sandbox-clamp.ts'
import { applyUltraSlash } from './host/ultra-slash/apply.ts'
import { registerSoundsHttp } from './host/workbench-sounds/http.ts'
import { WorkspaceFs } from './host/workspace-fs.ts'

export const name = 'dsh-workbench-plugin'
export const inject = ['tools', 'webServer', 'llm', 'agentDefaultModel', 'commands', 'sessionReferenceResolver', 'workspaceRegistry']

/** Host half: Git service, workspace files, JSON API, model-facing tools, Ultra Slash, and sounds. */
export function apply(ctx: Context): void {
  const git = new GitService()
  const fs = new WorkspaceFs()
  ctx.effect(() => registerGitHttp(ctx, git, fs), 'workbench: http')
  ctx.effect(() => registerGitTools(ctx, git), 'workbench: tools')
  ctx.effect(() => registerBrowserAgent(ctx), 'workbench: browser agent')
  ctx.effect(() => registerSessionRefArchiveFilter(ctx), 'workbench: session-ref archive filter')
  ctx.effect(() => registerSandboxClamp(ctx), 'workbench: sandbox clamp')
  applyUltraSlash(ctx)
  ctx.effect(() => {
    const server = ctx.webServer
    if (server === undefined || typeof server.register !== 'function') return () => {}
    return registerSoundsHttp(server)
  }, 'workbench: sounds http')
}
