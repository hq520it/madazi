import { Router } from 'express';
import { db } from '../db/init.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { getProjectRole } from '../middleware/permission.js';
import {
  packageTemplate,
  installTemplate,
  listMarketTemplates,
  getTemplateDetail,
  rateTemplate,
  archiveTemplate,
  listPendingReviews,
  reviewVersion,
} from '../services/market.js';

/**
 * 模板市场路由（doc/2026-08-23-模板市场设计.md §六）
 * 全部需登录（cookie / Bearer 均可，auth 中间件已兼容）
 */

const router = Router();
router.use(auth);

// 统一错误映射：service 层 fail(statusCode, msg) → HTTP
const handleError = (res, err) => {
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message, ...(err.details || {}) });
  }
  console.error('[market] 未预期错误:', err);
  return res.status(500).json({ error: '服务器内部错误' });
};

// 当前用户是否管理员（查库取最新 role，JWT 内是签发快照）
async function isAdminNow(userId) {
  try {
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    return rows[0]?.role === 'admin';
  } catch {
    return false;
  }
}

// ── 浏览 ──

// 模板列表：search / category / tag / sort=popular|newest|rating / mine / limit / offset
router.get('/templates', async (req, res) => {
  try {
    const isAdmin = await isAdminNow(req.user.id);
    const list = await listMarketTemplates({
      search: req.query.search,
      category: req.query.category,
      tag: req.query.tag,
      sort: req.query.sort,
      mine: req.query.mine === '1' || req.query.mine === 'true',
      userId: req.user.id,
      isAdmin,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(list);
  } catch (err) {
    handleError(res, err);
  }
});

// 模板详情：元数据 + 版本列表 + README + 我的评分
router.get('/templates/:slug', async (req, res) => {
  try {
    const isAdmin = await isAdminNow(req.user.id);
    const detail = await getTemplateDetail(req.params.slug, { userId: req.user.id, isAdmin });
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
});

// ── 发布（需项目管理权限：owner / 项目 admin / 系统管理员） ──

router.post('/templates/publish', async (req, res) => {
  try {
    const { projectId, name, description, category, tags, visibility, version, changelog } = req.body;
    if (!projectId || !name || !version) {
      return res.status(400).json({ error: 'projectId, name, version 不能为空' });
    }
    const role = await getProjectRole(req.user.id, projectId);
    if (!['owner', 'admin', 'system_admin'].includes(role)) {
      return res.status(403).json({ error: '需要项目管理权限才能发布模板' });
    }
    const result = await packageTemplate({
      projectId, name, description, category, tags, visibility, version, changelog,
      userId: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ── 安装（一键创建项目） ──

router.post('/templates/:slug/install', async (req, res) => {
  try {
    const { name, version } = req.body;
    const isAdmin = await isAdminNow(req.user.id);
    const project = await installTemplate({
      slug: req.params.slug, name, version,
      userId: req.user.id, isAdmin,
    });
    res.status(201).json(project);
  } catch (err) {
    handleError(res, err);
  }
});

// ── 评分 / 下架 ──

router.post('/templates/:slug/rate', async (req, res) => {
  try {
    const { score, comment } = req.body;
    const result = await rateTemplate(req.params.slug, { userId: req.user.id, score, comment });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/templates/:slug/archive', async (req, res) => {
  try {
    const result = await archiveTemplate(req.params.slug, req.user.id);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 管理员审核（挂载于 /api/admin/market）
// ─────────────────────────────────────────────────────────────

export const adminRouter = Router();
adminRouter.use(auth, adminOnly);

// 待审核队列
adminRouter.get('/pending', async (req, res) => {
  try {
    res.json(await listPendingReviews());
  } catch (err) {
    handleError(res, err);
  }
});

// 批准 / 驳回（body: { reason }，驳回时填写）
adminRouter.post('/templates/:id/versions/:versionId/approve', async (req, res) => {
  try {
    const result = await reviewVersion(req.params.id, req.params.versionId, {
      approved: true, adminId: req.user.id,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

adminRouter.post('/templates/:id/versions/:versionId/reject', async (req, res) => {
  try {
    const result = await reviewVersion(req.params.id, req.params.versionId, {
      approved: false, reason: req.body?.reason, adminId: req.user.id,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
