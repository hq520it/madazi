import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/init.js';
import { auth } from '../middleware/auth.js';
import { projectAccess, projectManageAccess, projectOwnerAccess, getProjectRole } from '../middleware/permission.js';
import { getProjectOnlineUsers } from '../services/project-ws.js';
import { publish } from '../services/bus.js';
import { bumpAccessMap } from '../services/access-map-events.js';

const router = Router();

// 所有路由需要登录
router.use(auth);

// async 错误捕获包装
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 获取项目成员列表（含 owner 信息）
router.get('/:id/members', projectAccess, wrap(async (req, res) => {
  const { id: projectId } = req.params;

  const projRows = await db.query(
    `SELECT p.owner_id, u.username, u.role as system_role
     FROM projects p JOIN users u ON p.owner_id = u.id
     WHERE p.id = $1`,
    [projectId]
  );
  if (projRows.rows.length === 0) {
    return res.status(404).json({ error: '项目不存在' });
  }

  const owner = projRows.rows[0];

  const memberRows = await db.query(
    `SELECT pm.user_id, pm.role, u.username, pm.created_at
     FROM project_members pm
     JOIN users u ON pm.user_id = u.id
     WHERE pm.project_id = $1
     ORDER BY pm.created_at ASC`,
    [projectId]
  );

  res.json({
    owner: {
      user_id: owner.owner_id,
      username: owner.username,
      role: 'owner',
    },
    members: memberRows.rows.map(m => ({
      user_id: m.user_id,
      username: m.username,
      role: m.role,
      created_at: m.created_at,
    })),
  });
}));

// 搜索可添加的用户（排除已在项目中的）
// ★ P2 B11：仅管理员可搜索（原 projectAccess 让任意成员可枚举全站用户名）
router.get('/:id/members/search', projectManageAccess, wrap(async (req, res) => {
  const { id: projectId } = req.params;
  const { q } = req.query;

  if (!q || q.trim().length < 1) {
    return res.json([]);
  }

  // 转义 ILIKE 通配符
  const escapedQ = q.trim().replace(/[%_\\]/g, '\\$&');

  const { rows } = await db.query(
    `SELECT u.id, u.username
     FROM users u
     WHERE u.username ILIKE $1 ESCAPE '\\'
       AND u.id NOT IN (
         SELECT owner_id FROM projects WHERE id = $2
         UNION
         SELECT user_id FROM project_members WHERE project_id = $2
       )
     LIMIT 10`,
    [`%${escapedQ}%`, projectId]
  );

  res.json(rows);
}));

// 添加成员
router.post('/:id/members', projectManageAccess, wrap(async (req, res) => {
  const { id: projectId } = req.params;
  const { username, role } = req.body;

  if (!username) {
    return res.status(400).json({ error: '用户名不能为空' });
  }
  if (role !== 'admin' && role !== 'developer') {
    return res.status(400).json({ error: '角色必须是 admin 或 developer' });
  }

  const userRows = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (userRows.rows.length === 0) {
    return res.status(404).json({ error: '用户不存在' });
  }
  const userId = userRows.rows[0].id;

  const projRows = await db.query('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
  if (projRows.rows.length === 0) {
    return res.status(404).json({ error: '项目不存在' });
  }
  if (projRows.rows[0].owner_id === userId) {
    return res.status(400).json({ error: '该用户是项目创建人，无需添加' });
  }

  const existing = await db.query(
    'SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: '该用户已是项目成员' });
  }

  const id = uuid();
  await db.query(
    `INSERT INTO project_members (id, project_id, user_id, role, added_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, projectId, userId, role, req.user.id]
  );
  bumpAccessMap(); // 成员新增 → 权限根变更 → 推送映射更新

  // ★ 协同实时：广播「新成员加入」（bus → project-ws → 目标用户全局 WS →
  //   前端自动创建 workspace + 刷新项目列表，被加进项目立即可见）
  try {
    const proj = await db.query('SELECT name FROM projects WHERE id = $1', [projectId]);
    publish({
      t: 'member_added',
      userId,
      projectId,
      projectName: proj.rows[0]?.name || '',
      addedBy: req.user?.username || '',
    });
  } catch (e) {
    console.warn('[members] member_added publish failed:', e.message);
  }

  res.status(201).json({ user_id: userId, username, role });
}));

// 修改成员角色
router.put('/:id/members/:userId', projectManageAccess, wrap(async (req, res) => {
  const { id: projectId, userId } = req.params;
  const { role } = req.body;

  if (role !== 'admin' && role !== 'developer') {
    return res.status(400).json({ error: '角色必须是 admin 或 developer' });
  }

  const projRows = await db.query('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
  if (projRows.rows.length === 0) {
    return res.status(404).json({ error: '项目不存在' });
  }
  if (projRows.rows[0].owner_id === userId) {
    return res.status(400).json({ error: '不能修改项目创建人的角色' });
  }

  // admin 不能修改其他 admin 的角色（只有 owner 可以）
  const targetRole = await getProjectRole(userId, projectId);
  const myRole = req.projectRole;
  if (targetRole === 'admin' && myRole === 'admin') {
    return res.status(403).json({ error: '管理员不能修改其他管理员的角色' });
  }

  const result = await db.query(
    'UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3 RETURNING *',
    [role, projectId, userId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: '该用户不是项目成员' });
  }

  res.json({ user_id: userId, role });
}));

// 移除成员（★ 权限收紧：仅创建人 + 平台管理员可移除，项目管理员不可——projectOwnerAccess）
router.delete('/:id/members/:userId', projectOwnerAccess, wrap(async (req, res) => {
  const { id: projectId, userId } = req.params;

  const projRows = await db.query('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
  if (projRows.rows.length === 0) {
    return res.status(404).json({ error: '项目不存在' });
  }
  if (projRows.rows[0].owner_id === userId) {
    return res.status(400).json({ error: '不能移除项目创建人' });
  }

  const result = await db.query(
    'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING *',
    [projectId, userId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: '该用户不是项目成员' });
  }
  bumpAccessMap(); // 成员移除 → 权限根变更 → 推送映射更新

  res.json({ success: true });
}));

// 获取项目在线用户（通过 project-ws WebSocket 连接状态）
router.get('/:id/online', projectAccess, wrap(async (req, res) => {
  const { id: projectId } = req.params;
  const users = getProjectOnlineUsers(projectId);
  res.json({ users });
}));

export default router;
