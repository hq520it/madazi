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
/** Successful refresh cadence; the fence also re-polls on a failure backoff. */
const MEMBERSHIP_REFRESH_MS = 30_000;
/** Failure backoff — shorter so membership returns promptly after a blip. */
const MEMBERSHIP_RETRY_MS = 5_000;
/** Dsh workspace paths under this directory are project paths (`/api/projects` ids). */
const PROJECT_PATH_PATTERN = /generated\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
let table = { ready: false, allowed: new Set() };
let version = 0;
const listeners = new Set();
let watchStarted = false;
/** Session ids of denied workspaces, collected by the last gatedWorkspaces pass. */
let hiddenSessionIds = new Set();
let authFailed = false;
let timer;
let workspaceCache;
let listCache;
function notify() {
    version += 1;
    for (const listener of listeners)
        listener();
}
/** Observable version of the membership table; increments on every applied refresh. */
export function getMembershipVersion() {
    return version;
}
/**
 * Subscribe to membership-table changes.
 * @param listener - fired after a refresh changes the applied table.
 * @returns the unsubscribe function.
 */
export function subscribeMembership(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
/** The table has been fetched at least once (fail-closed until then). */
export function membershipIsReady() {
    return table.ready;
}
/**
 * True when a project path is denied for the current operator. Every
 * `generated/<uuid>` workspace stays hidden until the table both arrives and
 * lists it.
 * @param path - a workspace or session working-directory path.
 * @returns true when the path names a project outside the caller's allowed set.
 */
export function isDeniedPath(path) {
    if (typeof path !== 'string')
        return false;
    const projectId = PROJECT_PATH_PATTERN.exec(path)?.[1];
    if (projectId === undefined)
        return false;
    return !table.ready || !table.allowed.has(projectId.toLowerCase());
}
/**
 * Fetch the membership table from the platform gateway. A 401 trips the auth
 * fuse: polling stops until the login plugin raises `__madaziLoggedIn`, after
 * which the next call resumes the watch.
 * @returns true when a table was applied this call.
 */
async function refreshMembership() {
    const globals = globalThis;
    if (authFailed && globals.__madaziLoggedIn === true) {
        authFailed = false;
        if (timer === undefined)
            scheduleTick(0);
    }
    if (authFailed)
        return false;
    try {
        const response = await fetch('/api/projects', { credentials: 'same-origin' });
        if (response.status === 401) {
            authFailed = true;
            return false;
        }
        if (!response.ok)
            return false;
        const body = await response.json().catch(() => undefined);
        if (!Array.isArray(body))
            return false;
        const allowed = new Set();
        for (const entry of body) {
            if (entry === null || typeof entry !== 'object')
                continue;
            const { id, status } = entry;
            if (status === 'archived')
                continue;
            if (typeof id !== 'string' || id.length === 0)
                continue;
            allowed.add(id.toLowerCase());
        }
        let changed = !table.ready || allowed.size !== table.allowed.size;
        if (!changed) {
            for (const id of allowed) {
                if (!table.allowed.has(id)) {
                    changed = true;
                    break;
                }
            }
        }
        table = { ready: true, allowed };
        if (changed)
            notify();
        return true;
    }
    catch {
        return false;
    }
}
function scheduleTick(delay) {
    if (timer !== undefined)
        clearTimeout(timer);
    timer = setTimeout(() => {
        timer = undefined;
        void refreshMembership().then((ok) => {
            if (authFailed)
                return;
            scheduleTick(ok ? MEMBERSHIP_REFRESH_MS : MEMBERSHIP_RETRY_MS);
        });
    }, delay);
}
/**
 * Begin the membership watch (idempotent). The login plugin may reach the
 * refresh through the legacy `__madaziMembershipRefresh` global.
 */
export function startMembershipWatch() {
    if (watchStarted)
        return;
    watchStarted = true;
    globalThis.__madaziMembershipRefresh =
        refreshMembership;
    scheduleTick(0);
}
/**
 * Drop workspaces the current operator cannot access, tracking their session
 * ids for {@link gatedList}. The applied output is cached per input reference
 * and table version, so components may render it stably.
 * @param workspaces - authoritative workspace list.
 * @returns the caller-visible subset (same reference while table and input hold).
 */
export function gatedWorkspaces(workspaces) {
    if (!Array.isArray(workspaces))
        return workspaces;
    if (workspaceCache !== undefined && workspaceCache.raw === workspaces && workspaceCache.v === version) {
        return workspaceCache.out;
    }
    hiddenSessionIds = new Set();
    const kept = [];
    for (const workspace of workspaces) {
        if (workspace !== null && isDeniedPath(workspace.path)) {
            for (const sid of workspace.sessionIds)
                hiddenSessionIds.add(sid);
            continue;
        }
        kept.push(workspace);
    }
    workspaceCache = { raw: workspaces, v: version, out: kept };
    return kept;
}
/**
 * Project the session list onto the caller's view: rows under denied
 * workspaces vanish from ids/byId/subagent/jobs projections and the current
 * selection is dropped when it falls inside a denied project.
 * @param list - full session list snapshot.
 * @returns the caller-visible projection (same reference while input holds).
 */
export function gatedList(list) {
    if (list === null || typeof list !== 'object')
        return list;
    if (listCache !== undefined && listCache.raw === list && listCache.v === version) {
        return listCache.out;
    }
    const deniedRow = (sid) => {
        if (hiddenSessionIds.has(sid))
            return true;
        const summary = list.byId[sid];
        if (summary !== undefined && isDeniedPath(summary.cwd))
            return true;
        return false;
    };
    const ids = list.ids.filter(id => !deniedRow(id));
    const byId = {};
    for (const key in list.byId) {
        const sid = key;
        if (Object.hasOwn(list.byId, key) && !deniedRow(sid)) {
            byId[sid] = list.byId[sid];
        }
    }
    const current = list.current !== undefined && !deniedRow(list.current) ? list.current : undefined;
    const subagentsByParent = {};
    for (const parentKey in list.subagentsByParent) {
        const parent = parentKey;
        if (Object.hasOwn(list.subagentsByParent, parentKey) && !hiddenSessionIds.has(parent)) {
            subagentsByParent[parent] = list.subagentsByParent[parent];
        }
    }
    const jobsBySession = {};
    for (const jobKey in list.jobsBySession) {
        const sid = jobKey;
        if (Object.hasOwn(list.jobsBySession, jobKey) && !hiddenSessionIds.has(sid)) {
            jobsBySession[sid] = list.jobsBySession[sid];
        }
    }
    const out = {
        ids,
        byId,
        current,
        phase: list.phase,
        subagentsByParent,
        jobsBySession,
        currentAddress: list.currentAddress,
    };
    listCache = { raw: list, v: version, out };
    return out;
}
//# sourceMappingURL=membership-gate.js.map