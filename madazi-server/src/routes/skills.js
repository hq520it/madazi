import { Router } from 'express';
import { db } from '../db/init.js';
import { v4 as uuid } from 'uuid';
import { auth } from '../middleware/auth.js';
import { projectAccess } from '../middleware/permission.js';
import fs from 'fs';
import path from 'path';
import { DSH_HOME } from '../config/paths.js';

const router = Router();

// ★ 技能落盘目录：官方 dsh-skill-filesystem 扫 <项目>/.dsh/skills（rank 100）与 .agents/skills（rank 200）。
//   默认用 .agents/skills（Claude Code 惯例，跨生态兼容更好）；勿用 .agent/skills（单数，官方不扫）。
const SKILLS_SUBDIR = path.join('.agents', 'skills');

// kebab-case slug：DSH 技能名只认 /^[a-z0-9]+(?:-[a-z0-9]+)*$/，中文名会被官方整体忽略
function toSlug(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'skill';
}

// ★ 全局内置技能目录：官方 DSH 用户级技能根 $DSH_HOME/skills（rank 400，所有项目自动可见）。
//   部署中 dsh-web 设 DSH_HOME=/app/generated/.dsh（共享 PVC）→ 写这里 = 全项目免安装。
//   项目级技能（.dsh/skills rank100 / .agents/skills rank200）优先级更高，可覆盖内置。
const GLOBAL_SKILLS_DIR = path.join(DSH_HOME, 'skills');

// 内置技能全局同步（幂等）：把 is_builtin 的公开技能写进 $DSH_HOME/skills，
// 并清掉已取消内置的残留文件。server 启动时调用，失败不阻塞启动。
export async function syncGlobalSkills() {
  const { rows } = await db.query(
    `SELECT id, name, slug, description, icon, color, prompt
     FROM skills WHERE is_builtin = TRUE AND is_public = TRUE`
  );
  fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
  const want = new Set();
  for (const s of rows) {
    const slug = toSlug(s.slug || s.name);
    want.add(slug);
    const content = `---
name: "${slug}"
description: "${(s.description || '').replace(/"/g, '\\"')}"
icon: ${s.icon || 'sparkles'}
color: ${s.color || '#5E6AD2'}
---

${s.prompt}`;
    fs.writeFileSync(path.join(GLOBAL_SKILLS_DIR, `${slug}.md`), content, 'utf-8');
  }
  for (const f of fs.readdirSync(GLOBAL_SKILLS_DIR)) {
    if (f.endsWith('.md') && !want.has(f.replace(/\.md$/, ''))) {
      fs.unlinkSync(path.join(GLOBAL_SKILLS_DIR, f));
    }
  }
  return rows.length;
}

// 所有技能接口都需要登录
router.use(auth);

// ============ 全局技能库 ============

// 浏览技能库（所有公开技能）
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, slug, description, icon, color, category, author_name, is_builtin, install_count, created_at
       FROM skills WHERE is_public = TRUE
       ORDER BY install_count DESC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('获取技能库失败:', err);
    res.status(500).json({ error: '获取技能库失败' });
  }
});

// 我的技能（个人发布的所有技能，含未公开草稿）
router.get('/mine', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, slug, description, icon, color, category, is_builtin, is_public, install_count, created_at
       FROM skills WHERE author_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('获取我的技能失败:', err);
    res.status(500).json({ error: '获取我的技能失败' });
  }
});

// 获取单个技能详情（含 prompt）
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM skills WHERE id = $1 AND is_public = TRUE`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '技能不存在' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: '获取技能详情失败' });
  }
});

// 分享技能到技能库
router.post('/', async (req, res) => {
  const { name, description, icon, color, prompt, category, slug, is_builtin } = req.body;
  if (!name || !prompt) return res.status(400).json({ error: '名称和 prompt 不能为空' });

  const id = uuid();
  const userId = req.user?.id;
  const userName = req.user?.username;
  // ★ DSH 触发名：优先用发布者给的英文标识，否则由中文名转（中文会被压成 skill，发布表单建议填英文标识）
  const skillSlug = slug ? toSlug(slug) : toSlug(name);
  // ★ 官方内置：仅管理员可发布为官方（全项目自动可用）；普通用户请求强制 false
  const builtin = !!(is_builtin && req.user?.role === 'admin');

  try {
    const { rows } = await db.query(
      `INSERT INTO skills (id, name, slug, description, icon, color, prompt, category, author_id, author_name, is_builtin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [id, name, skillSlug, description || '', icon || 'sparkles', color || '#5E6AD2', prompt, category || 'general', userId, userName, builtin]
    );
    // 内置技能发布即同步到全局目录（幂等，无需等重启）；非内置不触发
    if (builtin) {
      try { await syncGlobalSkills(); } catch (err) { console.error('内置技能发布同步失败:', err.message); }
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('分享技能失败:', err);
    res.status(500).json({ error: '分享技能失败' });
  }
});

// 安装技能到项目（写入 .agent/skills/ 目录）
// ★ P1-7 修复：加 projectAccess，防止任意登录用户向任意项目注入 .agent/skills/*.md（prompt 注入面）
router.post('/:id/install/:projectId', projectAccess, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM skills WHERE id = $1 AND is_public = TRUE`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '技能不存在' });

    const skill = rows[0];

    // 获取项目源码路径
    const { rows: projRows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.projectId]);
    if (!projRows[0]?.source_path) return res.status(404).json({ error: '项目不存在' });

    const skillsDir = path.join(projRows[0].source_path, SKILLS_SUBDIR);
    fs.mkdirSync(skillsDir, { recursive: true });

    // ★ 文件名用 DSH 触发名 slug（kebab-case），不是 uuid——官方按 frontmatter name 建目录索引
    const slug = toSlug(skill.slug || skill.name);
    const fileName = `${slug}.md`;
    const filePath = path.join(skillsDir, fileName);

    // 写入 .md 文件（frontmatter + body）；name 必须是 kebab-case，中文放 description
    const content = `---
name: "${slug}"
description: "${(skill.description || '').replace(/"/g, '\\"')}"
icon: ${skill.icon || 'sparkles'}
color: ${skill.color || '#5E6AD2'}
---

${skill.prompt}`;
    fs.writeFileSync(filePath, content, 'utf-8');

    // 增加安装计数
    await db.query('UPDATE skills SET install_count = install_count + 1 WHERE id = $1', [skill.id]);

    res.json({ ok: true, skill });
  } catch (err) {
    console.error('安装技能失败:', err);
    res.status(500).json({ error: '安装技能失败' });
  }
});

// 更新市场技能（作者本人或管理员，部分字段）；内置技能更新后立即同步全局目录
// ★ skill-creator 等官方技能内容维护走这里：改 prompt 后 syncGlobalSkills 覆盖 $DSH_HOME/skills
router.put('/:id', async (req, res) => {
  const { name, description, icon, color, prompt, category, slug, is_builtin } = req.body;
  const userId = req.user?.id;
  try {
    const { rows } = await db.query('SELECT * FROM skills WHERE id = $1', [req.params.id]);
    const skill = rows[0];
    if (!skill) return res.status(404).json({ error: '技能不存在' });
    if (skill.author_id !== userId && req.user?.role !== 'admin') return res.status(403).json({ error: '无权更新此技能' });
    // 内置状态仅管理员可改；非管理员忽略该字段（保留原值，防误降级）
    const nextBuiltin = req.user?.role === 'admin'
      ? (is_builtin !== undefined ? !!is_builtin : skill.is_builtin)
      : skill.is_builtin;
    const nextSlug = slug !== undefined ? toSlug(slug) : skill.slug;
    const { rows: upd } = await db.query(
      `UPDATE skills SET
        name = COALESCE($2, name),
        slug = COALESCE($3, slug),
        description = COALESCE($4, description),
        icon = COALESCE($5, icon),
        color = COALESCE($6, color),
        prompt = COALESCE($7, prompt),
        category = COALESCE($8, category),
        is_builtin = $9
       WHERE id = $1 RETURNING *`,
      [req.params.id, name ?? null, nextSlug, description ?? null, icon ?? null, color ?? null, prompt ?? null, category ?? null, nextBuiltin]
    );
    if (upd[0]?.is_builtin) {
      try { await syncGlobalSkills(); } catch (err) { console.error('内置技能更新同步失败:', err.message); }
    }
    res.json(upd[0]);
  } catch (err) {
    console.error('更新技能失败:', err);
    res.status(500).json({ error: '更新技能失败' });
  }
});

// 删除自己分享的技能
router.delete('/:id', async (req, res) => {
  const userId = req.user?.id;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM skills WHERE id = $1 AND author_id = $2',
      [req.params.id, userId]
    );
    if (rowCount === 0) return res.status(403).json({ error: '无权删除此技能' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除技能失败' });
  }
});

// ============ 项目技能（本地 .agent/skills/） ============

// 获取项目自定义技能（已有逻辑在 projects.js，这里提供一致的接口）
router.get('/project/:projectId', projectAccess, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.projectId]);
    if (!rows[0]?.source_path) return res.json([]);

    const skillsDir = path.join(rows[0].source_path, SKILLS_SUBDIR);
    if (!fs.existsSync(skillsDir)) return res.json([]);

    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
    const skills = files
      .map(f => {
        try {
          const content = fs.readFileSync(path.join(skillsDir, f), 'utf-8');
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
          if (!fmMatch) return null;
          const frontmatter = fmMatch[1];
          const body = fmMatch[2].trim();
          const meta = {};
          for (const line of frontmatter.split('\n')) {
            const m = line.match(/^(\w+):\s*(.*)$/);
            if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
          }
          const id = f.replace(/\.md$/, '');
          return {
            id: `custom-${id}`,
            name: meta.name || id,
            description: meta.description || '',
            icon: meta.icon || 'sparkles',
            color: meta.color || '#5E6AD2',
            bgColor: `rgba(94, 106, 210, 0.12)`,
            prompt: body,
            custom: true,
            fileName: f,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.json(skills);
  } catch (err) {
    console.error('获取项目技能失败:', err);
    res.json([]);
  }
});

// 创建项目自定义技能
router.post('/project/:projectId', projectAccess, async (req, res) => {
  const { name, description, icon, color, prompt } = req.body;
  if (!name || !prompt) return res.status(400).json({ error: '名称和 prompt 不能为空' });

  try {
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.projectId]);
    if (!rows[0]?.source_path) return res.status(404).json({ error: '项目不存在' });

    const skillsDir = path.join(rows[0].source_path, SKILLS_SUBDIR);
    fs.mkdirSync(skillsDir, { recursive: true });

    // 文件名：name 转 kebab-case slug（DSH 只认 ASCII kebab）；同名去重加 -2/-3
    let slug = toSlug(name);
    let fileName = `${slug}.md`;
    for (let n = 2; fs.existsSync(path.join(skillsDir, fileName)); n++) fileName = `${slug}-${n}.md`;
    slug = fileName.replace(/\.md$/, '');
    const filePath = path.join(skillsDir, fileName);

    const content = `---
name: "${slug}"
description: "${(description || '').replace(/"/g, '\\"')}"
icon: ${icon || 'sparkles'}
color: ${color || '#5E6AD2'}
---

${prompt}`;
    fs.writeFileSync(filePath, content, 'utf-8');

    res.json({ ok: true, fileName });
  } catch (err) {
    console.error('创建项目技能失败:', err);
    res.status(500).json({ error: '创建项目技能失败' });
  }
});

// 项目技能目录内路径校验（★ P1-8 修复：fileName 仅剥 .md，../../.. 可穿出 skills 目录）
function skillSafePath(sourcePath, fileName) {
  const base = path.resolve(sourcePath, SKILLS_SUBDIR);
  const full = path.resolve(base, fileName);
  const rel = path.relative(base, full);
  if (rel === '') return full; // 技能目录本身
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

// 更新项目自定义技能
router.put('/project/:projectId/:fileName', projectAccess, async (req, res) => {
  const { name, description, prompt, icon, color } = req.body;
  if (!name || !prompt) return res.status(400).json({ error: '名称和 prompt 不能为空' });

  try {
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.projectId]);
    if (!rows[0]?.source_path) return res.status(404).json({ error: '项目不存在' });

    // ★ fileName 可能带 .md 后缀（create_skill 返回的 fileName 带后缀），统一去后缀
    const baseName = req.params.fileName.replace(/\.md$/, '');
    const oldPath = skillSafePath(rows[0].source_path, `${baseName}.md`);
    if (!oldPath) return res.status(403).json({ error: '非法的技能文件名' });
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: '技能不存在' });

    // 文件名可能因为 name 变了需要更新（slug 化）
    const newFileName = `${toSlug(name)}.md`;
    const newPath = path.join(rows[0].source_path, SKILLS_SUBDIR, newFileName);

    const content = `---\nname: "${newFileName.replace(/\.md$/, '')}"\ndescription: "${(description || '').replace(/"/g, '\\"')}"\nicon: ${icon || 'sparkles'}\ncolor: ${color || '#5E6AD2'}\n---\n\n${prompt}`;
    fs.writeFileSync(newPath, content, 'utf-8');

    // 如果文件名变了，删除旧文件
    if (newFileName !== `${baseName}.md`) {
      fs.unlinkSync(oldPath);
    }

    res.json({ ok: true, fileName: newFileName });
  } catch (err) {
    console.error('更新项目技能失败:', err);
    res.status(500).json({ error: '更新项目技能失败' });
  }
});

// 分享项目私有技能到市场（对话里 /分享技能 → 读 .agents/skills/<name>.md → 写 skills 表）
// ★ 人工确认链路：AI 在对话里写出的技能先留项目私有，用户确认后才进公开市场
router.post('/project/:projectId/:fileName/share', projectAccess, async (req, res) => {
  const { displayName, description, category, is_builtin } = req.body;
  try {
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.projectId]);
    if (!rows[0]?.source_path) return res.status(404).json({ error: '项目不存在' });

    const baseName = req.params.fileName.replace(/\.md$/, '');
    const filePath = skillSafePath(rows[0].source_path, `${baseName}.md`);
    if (!filePath) return res.status(403).json({ error: '非法的技能文件名' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '技能不存在' });

    // 解析 frontmatter + body（与 GET /project/:id 同规则）
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fm) return res.status(400).json({ error: '技能文件格式无效（缺 frontmatter）' });
    const meta = {};
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    const body = fm[2].trim();

    // slug 取文件名（已 kebab-case）；显示名默认用 frontmatter name，分享表单可覆盖为中文
    const builtin = !!(is_builtin && req.user?.role === 'admin');
    const { rows: ins } = await db.query(
      `INSERT INTO skills (id, name, slug, description, icon, color, prompt, category, author_id, author_name, is_builtin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [uuid(), displayName || meta.name || baseName, baseName,
       description || meta.description || '', meta.icon || 'sparkles', meta.color || '#5E6AD2',
       body, category || meta.category || 'general', req.user?.id, req.user?.username, builtin]
    );
    // 内置技能分享即同步到全局目录
    if (builtin) {
      try { await syncGlobalSkills(); } catch (err) { console.error('内置技能分享同步失败:', err.message); }
    }
    res.json(ins[0]);
  } catch (err) {
    console.error('分享技能失败:', err);
    res.status(500).json({ error: '分享技能失败' });
  }
});

// 删除项目自定义技能
router.delete('/project/:projectId/:fileName', projectAccess, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [req.params.projectId]);
    if (!rows[0]?.source_path) return res.status(404).json({ error: '项目不存在' });

    const baseName = req.params.fileName.replace(/\.md$/, '');
    // ★ P1-8 修复：防止 fileName 携带 ../.. 穿出 skills 目录删除任意 .md
    const filePath = skillSafePath(rows[0].source_path, `${baseName}.md`);
    if (!filePath) return res.status(403).json({ error: '非法的技能文件名' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '技能不存在' });

    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    console.error('删除项目技能失败:', err);
    res.status(500).json({ error: '删除项目技能失败' });
  }
});

export default router;
