import { db } from '../db/init.js';

// 获取用户在项目中的角色（单次 JOIN 查询）
// 返回: 'owner' | 'admin' | 'developer' | 'system_admin' | null
export async function getProjectRole(userId, projectId) {
  const { rows } = await db.query(
    `SELECT u.role as system_role, p.owner_id, pm.role as member_role
     FROM users u
     LEFT JOIN projects p ON p.id = $2
     LEFT JOIN project_members pm ON pm.project_id = $2 AND pm.user_id = $1
     WHERE u.id = $1`,
    [userId, projectId]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  if (row.system_role === 'admin') return 'system_admin';
  if (row.owner_id === userId) return 'owner';
  if (row.member_role) return row.member_role; // 'admin' | 'developer'

  return null;
}

// 项目权限检查中间件
// 1. 系统管理员 -> 所有项目
// 2. owner_id = 当前用户
// 3. project_members 中有记录
// 4. is_shared = true（兼容旧逻辑）
export async function projectAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录' });
  }
  const projectId = req.params.id || req.params.projectId;
  if (!projectId) {
    return next();
  }

  const role = await getProjectRole(req.user.id, projectId);
  if (role) {
    req.projectRole = role; // 注入项目角色供后续使用
    return next();
  }

  // 兼容 is_shared
  const { rows } = await db.query('SELECT is_shared FROM projects WHERE id = $1', [projectId]);
  if (rows.length > 0 && rows[0].is_shared === true) {
    req.projectRole = 'shared';
    return next();
  }

  return res.status(403).json({ error: '无权访问该项目' });
}

// ★ P0-A3 修复：项目写权限——可读（含 shared）+ 但 is_shared 项目只读
// 原实现：is_shared 项目任何登录用户直接通过 projectAccess，写端点（文件编辑/生成/上传等）
// 全部可用 -> 越权写任意共享项目。新增写权限中间件：shared 角色一律 403。
export async function projectWriteAccess(req, res, next) {
  await projectAccess(req, res, () => {
    if (req.projectRole === 'shared') {
      return res.status(403).json({ error: '共享项目为只读，无法执行写操作' });
    }
    next();
  });
}

// 中间件：需要项目管理权限（owner 或 admin 或 system_admin）
export async function projectManageAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录' });
  }
  const projectId = req.params.id || req.params.projectId;
  const role = await getProjectRole(req.user.id, projectId);

  if (role === 'system_admin' || role === 'owner' || role === 'admin') {
    req.projectRole = role;
    return next();
  }
  return res.status(403).json({ error: '需要项目管理权限' });
}

// 中间件：仅 owner 或 system_admin
export async function projectOwnerAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录' });
  }
  const projectId = req.params.id || req.params.projectId;
  const role = await getProjectRole(req.user.id, projectId);

  if (role === 'system_admin' || role === 'owner') {
    req.projectRole = role;
    return next();
  }
  return res.status(403).json({ error: '需要项目创建人权限' });
}
