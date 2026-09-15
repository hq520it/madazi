/**
 * madazi platform membership gate — fork source port of the legacy injected
 * override (`dsh-client-ui-workspace-lib`, see madazi docs/CUSTOMIZATIONS.md C1).
 *
 * Per-user project permission fence: the browser fetches the platform
 * membership table (`/api/projects`) and every derive/action fail-closes any
 * workspace not in the caller's allowed set. `ready=false` denies everything
 * (no flash of foreign projects before the first table arrives).
 *
 * The old override was code injected into this package's compiled client.js;
 * this module replaces it at source level, so the fence changes with the fork
 * instead of a build-time bundle patch.
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client';
/** Observable version of the membership table; increments on every applied refresh. */
export declare function getMembershipVersion(): number;
/**
 * Subscribe to membership-table changes.
 * @param listener - fired after a refresh changes the applied table.
 * @returns the unsubscribe function.
 */
export declare function subscribeMembership(listener: () => void): () => void;
/** The table has been fetched at least once (fail-closed until then). */
export declare function membershipIsReady(): boolean;
/**
 * True when a project path is denied for the current operator. Every
 * `generated/<uuid>` workspace stays hidden until the table both arrives and
 * lists it.
 * @param path - a workspace or session working-directory path.
 * @returns true when the path names a project outside the caller's allowed set.
 */
export declare function isDeniedPath(path: unknown): boolean;
/**
 * Begin the membership watch (idempotent). The login plugin may reach the
 * refresh through the legacy `__madaziMembershipRefresh` global.
 */
export declare function startMembershipWatch(): void;
/**
 * Drop workspaces the current operator cannot access, tracking their session
 * ids for {@link gatedList}. The applied output is cached per input reference
 * and table version, so components may render it stably.
 * @param workspaces - authoritative workspace list.
 * @returns the caller-visible subset (same reference while table and input hold).
 */
export declare function gatedWorkspaces(workspaces: readonly WorkspaceView[]): readonly WorkspaceView[];
/**
 * Project the session list onto the caller's view: rows under denied
 * workspaces vanish from ids/byId/subagent/jobs projections and the current
 * selection is dropped when it falls inside a denied project.
 * @param list - full session list snapshot.
 * @returns the caller-visible projection (same reference while input holds).
 */
export declare function gatedList(list: SessionListState): SessionListState;
//# sourceMappingURL=membership-gate.d.ts.map