// ★ 会话数据层权限（2026-08-27）：
// dsh 为共享单实例，会话数据全局可见。平台网关（dsh-web-proxy）拦截 dsh 会话数据
// RPC（session.history/prompt/fork/rename/.../list/search），此处提供：
//   1) sessionId → projectId 解析：DB dsh_session_owners 优先（客户端上报），
//      缺失时读共享 PVC 的 session_projcache.json（identity.cwd = /app/generated/<pid>）兜底
//   2) 用户可访问项目集合缓存（30s TTL）
//   3) 会话读取校验（fail-closed）：有归属项目且非成员 → 拒绝；
//      归属解析不出 → PVC 有该会话且 cwd 非平台目录（普通 workspace）→ 放行；
//      平台目录会话但归属不明 / 未持久化 → 拒绝（安全优先，防漏）
import fs from 'fs';
import path from 'path';
import { db } from '../db/init.js';
import { getProjectRole } from '../middleware/permission.js';
import { DSH_STORAGES } from '../config/paths.js';

// dsh storages 落点 = 平台唯一路径源（k8s=/app/generated/.dsh/storages；单机版=DSH_HOME/storages）
const PROJCACHE = path.join(DSH_STORAGES, 'session_projcache');

// sessionId → projectId 解析缓存
const sidCache = new Map(); // sessionId -> { projectId, at }
const SID_TTL = 60_000;

// PVC session_projcache 内容缓存（10s TTL，避免每次解析读盘）
// Map<sessionId, { cwd: string, projectId: string|null }>
let projCache = null;
let projCacheAt = 0;
const PROJ_CACHE_TTL = 10_000;

function readProjCache() {
  if (projCache && Date.now() - projCacheAt < PROJ_CACHE_TTL) return projCache;
  projCache = new Map();
  projCacheAt = Date.now();
  // ★ 兼容两种存储形态（dsh 升级导致）：
  //   1) 旧单文件 /app/generated/.dsh/storages/session_projcache.json
  //     { tables: { sessions: { [sid]: { identity: { cwd } } } } }
  //   2) 新目录 /app/generated/.dsh/storages/session_projcache/sessions/*.json
  //     { version, record: { identity: { cwd }, rows: {...} } }
  const grab = (sid, rec) => {
    const identity = (rec && rec.identity) || (rec && rec.record && rec.record.identity) || {};
    const cwd = typeof identity.cwd === 'string' ? identity.cwd : '';
    const mm = cwd.match(/\/generated\/([0-9a-fA-F-]{36})/);
    projCache.set(sid, { cwd, projectId: mm ? mm[1] : null });
  };
  try {
    const single = `${PROJCACHE}.json`;
    if (fs.existsSync(single)) {
      const raw = JSON.parse(fs.readFileSync(single, 'utf8'));
      const sessions = raw && raw.tables && raw.tables.sessions ? raw.tables.sessions : {};
      for (const [sid, rec] of Object.entries(sessions)) grab(sid, rec);
    }
  } catch (e) { /* 单文件损坏 → 走目录来源 */ }
  try {
    const dir = `${PROJCACHE}/sessions`;
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const sid = f.slice(0, -5);
        const rec = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
        grab(sid, rec);
      }
    }
  } catch (e) { /* 目录损坏 → 忽略 */ }
  return projCache;
}

/**
 * sessionId → projectId（DB dsh_session_owners 优先，PVC session_projcache 兜底）
 * @returns {Promise<string|null>} null = 无法确认归属平台项目
 */
export async function sessionProjectId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) return null;
  const c = sidCache.get(sessionId);
  if (c && Date.now() - c.at < SID_TTL) return c.projectId;
  let projectId = null;
  try {
    const { rows } = await db.query('SELECT project_id FROM dsh_session_owners WHERE session_id = $1', [sessionId]);
    if (rows[0]) projectId = rows[0].project_id;
  } catch { /* DB 失败走 PVC */ }
  if (!projectId) {
    const rec = readProjCache().get(sessionId);
    if (rec && rec.projectId) projectId = rec.projectId;
  }
  sidCache.set(sessionId, { projectId, at: Date.now() });
  return projectId;
}

// 用户可访问项目 id 集合缓存（30s TTL；与 GET /api/projects 同过滤语义）
const userProjects = new Map(); // userId -> { set, at }
const UP_TTL = 30_000;

/**
 * 用户可访问项目 id 集合（owner / 成员 / 共享；系统管理员 = 全部项目）
 * @returns {Promise<Set<string>>}
 */
export async function userProjectSet(userId) {
  const c = userProjects.get(userId);
  if (c && Date.now() - c.at < UP_TTL) return c.set;
  let s = new Set();
  try {
    const { rows: uRows } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    const isAdmin = uRows[0] && uRows[0].role === 'admin';
    const { rows } = isAdmin
      ? await db.query("SELECT id FROM projects WHERE status != 'archived'")
      : await db.query(
          `SELECT p.id FROM projects p
           WHERE p.status != 'archived' AND (
             p.owner_id = $1 OR p.is_shared = true
             OR p.id IN (SELECT project_id FROM project_members WHERE user_id = $1)
           )`,
          [userId]
        );
    for (const r of rows) s.add(r.id);
  } catch { /* 查失败返回空集（保守） */ }
  userProjects.set(userId, { set: s, at: Date.now() });
  return s;
}

/**
 * 会话读取校验（fail-closed）：
 * - 有归属平台项目 → 成员（含 system_admin/owner）放行，否则拒绝
 * - 归属解析不出 → PVC 有该会话且 cwd 非平台目录（普通 workspace 会话）→ 放行；
 *   平台目录但归属不明 / 未持久化 → 拒绝（安全优先）
 * @returns {Promise<{ok: boolean, projectId: string|null}>}
 */
export async function canUserReadSession(userId, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return { ok: false, projectId: null };
  const projectId = await sessionProjectId(sessionId);
  if (projectId) {
    const role = await getProjectRole(userId, projectId);
    return role ? { ok: true, projectId } : { ok: false, projectId };
  }
  // 归属解析不出：查 PVC 记录区分普通 workspace 会话
  const rec = readProjCache().get(sessionId);
  if (rec && rec.cwd && !/\/generated\//.test(rec.cwd)) {
    return { ok: true, projectId: null }; // 普通 workspace 会话（非平台目录）
  }
  // 平台目录会话但归属不明 / 未持久化：fail-closed 拒绝
  return { ok: false, projectId: null };
}

// ★ workspaceId → 平台项目 id（读共享 storages workspace.json 的 path = <PROJECTS_ROOT>/<pid>）
const WORKSPACE_JSON = path.join(DSH_STORAGES, 'workspace.json');
let wsCache = null;
let wsCacheAt = 0;
const WS_TTL = 10_000;

function readWorkspaceCache() {
  if (wsCache && Date.now() - wsCacheAt < WS_TTL) return wsCache;
  wsCache = new Map();
  wsCacheAt = Date.now();
  try {
    if (!fs.existsSync(WORKSPACE_JSON)) return wsCache;
    const raw = JSON.parse(fs.readFileSync(WORKSPACE_JSON, 'utf8'));
    const ws = raw && raw.tables && raw.tables.workspaces ? raw.tables.workspaces : {};
    for (const [wid, rec] of Object.entries(ws)) {
      wsCache.set(wid, (rec && rec.path) || '');
    }
  } catch { /* 解析失败 → 空缓存 */ }
  return wsCache;
}

/** workspaceId → 平台项目 id（非平台 workspace 返回 null） */
export function workspaceProjectId(workspaceId) {
  if (!workspaceId || typeof workspaceId !== 'string') return null;
  const path = readWorkspaceCache().get(workspaceId) || '';
  const m = path.match(/\/generated\/([0-9a-fA-F-]{36})/);
  return m ? m[1] : null;
}
