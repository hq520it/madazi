import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import archiver from 'archiver';
import { db } from '../db/init.js';
import { scanProjectForPublish, collectPackageFiles } from './market-scan.js';
import { listTemplates, getTemplatePath } from './template.js';
import { PROJECTS_ROOT } from '../config/paths.js';

/**
 * 模板市场服务（doc/2026-08-23-模板市场设计.md）
 *
 * 包格式 zip（复用 archiver/unzipper 与 import-zip 已验证的解压防护）；
 * 存储在 generated/.market-packages 下（k8s 中该目录挂 PVC，持久化），
 * 文件名 = sha256（内容寻址，天然去重，安装时校验完整性）。
 */

// 项目生成根目录 = 平台唯一路径源（k8s 中挂 PVC 持久化）
const GENERATED_DIR = PROJECTS_ROOT;
const MARKET_STORAGE = path.join(GENERATED_DIR, '.market-packages');

/** 带 statusCode 的业务错误（路由层统一捕获映射 HTTP 状态码） */
function fail(statusCode, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
}

function safeParseTags(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 名称 → slug：小写字母/数字/中文保留，其余折叠为 - */
function slugify(name) {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'template';
}

/** 模板卡片图标：取词首字母（ASCII）或名称前两字符 */
function makeIcon(name) {
  const letters = String(name || '').split(/\s+/).map((w) => w[0]).filter((c) => c && /[a-zA-Z0-9]/.test(c));
  if (letters.length >= 2) return letters.slice(0, 2).join('').toUpperCase();
  return String(name || 'T').slice(0, 2);
}

async function sha256File(p) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(p)
      .on('data', (c) => hash.update(c))
      .on('end', resolve)
      .on('error', reject);
  });
  return hash.digest('hex');
}

// ─────────────────────────────────────────────────────────────
// 发布：项目 → 密钥扫描 → zip 打包 → 落库
// ─────────────────────────────────────────────────────────────

/**
 * 发布 / 更新版本
 * - 同一用户对同一项目再次发布 → 追加版本（沿用模板记录，更新元数据）
 * - slug 冲突（他人占用）→ 自动加 -2/-3 后缀
 * @param {{ projectId, userId, name, description, category, tags, visibility, version, changelog }} input
 */
export async function packageTemplate(input) {
  const { projectId, userId } = input;
  const name = String(input.name || '').trim();
  const version = String(input.version || '').trim();
  const visibility = input.visibility === 'public' ? 'public' : 'private';
  if (!name) throw fail(400, '模板名称不能为空');
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw fail(400, '版本号需为 semver 格式（如 1.0.0）');
  }
  const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10) : [];

  const { rows: projRows } = await db.query(
    'SELECT id, name, description, tech_stack, app_type, source_path FROM projects WHERE id = $1',
    [projectId]
  );
  const project = projRows[0];
  if (!project) throw fail(404, '项目不存在');
  if (!project.source_path || !fs.existsSync(project.source_path)) {
    throw fail(400, '项目源码目录不存在，无法打包');
  }

  // 1. 密钥扫描：命中不阻断发布，仅作为警告随成功响应返回（前端提示用）
  const scan = scanProjectForPublish(project.source_path);

  // 2. 收集进包文件（与扫描同一套排除逻辑）
  const packageFiles = collectPackageFiles(project.source_path);

  // 3. 定位目标模板：同项目同作者 → 追加版本；否则按 slug 新建
  let tpl;
  const { rows: existing } = await db.query(
    "SELECT * FROM templates WHERE origin_project_id = $1 AND author_id = $2 AND status <> 'archived'",
    [projectId, userId]
  );
  if (existing[0]) {
    tpl = existing[0];
  } else {
    let slug = slugify(name);
    let suffix = 2;
    // slug 被他人占用则加后缀
    for (;;) {
      const { rows: dup } = await db.query('SELECT id, author_id FROM templates WHERE slug = $1', [slug]);
      if (!dup[0] || dup[0].author_id === userId) {
        if (dup[0]) {
          // 本人已有同名 slug 模板（可能来自其他项目）→ 视为追加版本目标
          tpl = dup[0];
        }
        break;
      }
      slug = `${slugify(name)}-${suffix++}`;
    }
  }

  const isNewTemplate = !tpl;
  const templateId = tpl ? tpl.id : uuid();
  const slug = tpl ? tpl.slug : slugify(name);

  // 版本唯一性
  if (tpl) {
    const { rows: dupVer } = await db.query(
      'SELECT id FROM template_versions WHERE template_id = $1 AND version = $2',
      [templateId, version]
    );
    if (dupVer[0]) {
      // 返回当前最新版本，前端可据此自动递增
      const { rows: latestRows } = await db.query(
        "SELECT version FROM template_versions WHERE template_id = $1 ORDER BY created_at DESC LIMIT 1",
        [templateId]
      );
      const latestVersion = latestRows[0]?.version || tpl.latest_version || '1.0.0';
      throw fail(409, `版本 ${version} 已存在，请递增版本号`, { latest_version: latestVersion });
    }
  }

  // 4. 打 zip（archiver 边写边算 sha256）
  fs.mkdirSync(MARKET_STORAGE, { recursive: true });
  const tmpPath = path.join(MARKET_STORAGE, `tmp-${uuid()}.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const hash = crypto.createHash('sha256');
  archive.on('data', (c) => hash.update(c));

  const { rows: userRows } = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
  const authorName = userRows[0]?.username || '';

  const metaJson = {
    id: slug,
    name,
    version,
    description: input.description || '',
    category: input.category || 'fullstack',
    tags,
    tech_stack: project.tech_stack,
    app_type: project.app_type || 'web',
    author: { id: userId, name: authorName },
  };
  archive.append(Buffer.from(JSON.stringify(metaJson, null, 2)), { name: 'template.json' });

  let readme = '';
  const hasReadme = packageFiles.includes('README.md');
  if (hasReadme) {
    readme = fs.readFileSync(path.join(project.source_path, 'README.md'), 'utf-8');
    archive.append(Buffer.from(readme), { name: 'README.md' });
  } else {
    readme = `# ${name}\n\n${input.description || ''}\n`;
    archive.append(Buffer.from(readme), { name: 'README.md' });
  }

  for (const rel of packageFiles) {
    archive.file(path.join(project.source_path, rel), { name: rel });
  }

  const ws = fs.createWriteStream(tmpPath);
  await new Promise((resolve, reject) => {
    archive.on('error', reject);
    ws.on('error', reject);
    ws.on('close', resolve);
    archive.pipe(ws);
    archive.finalize().catch(reject);
  });

  // 5. 内容寻址落盘（sha256 前两位分桶）
  const sha = hash.digest('hex');
  const size = fs.statSync(tmpPath).size;
  const bucketDir = path.join(MARKET_STORAGE, sha.slice(0, 2));
  fs.mkdirSync(bucketDir, { recursive: true });
  const pkgPath = path.join(bucketDir, `${sha}.zip`);
  fs.renameSync(tmpPath, pkgPath);

  // 6. 落库：私有 → 直接 published/approved；公开 → pending 待审核
  const tplStatus = visibility === 'private' ? 'published' : 'pending';
  const verStatus = visibility === 'private' ? 'approved' : 'pending';

  if (isNewTemplate) {
    await db.query(
      `INSERT INTO templates
        (id, slug, name, description, app_type, author_id, author_name, source_type,
         origin_project_id, visibility, category, tags, icon, status, latest_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'user',$8,$9,$10,$11,$12,$13,$14)`,
      [
        templateId, slug, name, input.description || '', project.app_type || 'web',
        userId, authorName, projectId, visibility,
        input.category || 'fullstack', JSON.stringify(tags), makeIcon(name),
        tplStatus, version,
      ]
    );
  } else {
    await db.query(
      `UPDATE templates SET name=$2, description=$3, category=$4, tags=$5, visibility=$6,
         status=$7, latest_version=$8, updated_at=NOW()
       WHERE id=$1`,
      [templateId, name, input.description || '', input.category || 'fullstack',
        JSON.stringify(tags), visibility, tplStatus, version]
    );
  }

  const versionId = uuid();
  await db.query(
    `INSERT INTO template_versions
      (id, template_id, version, changelog, readme, pkg_path, pkg_size, pkg_sha256,
       file_count, tech_stack, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [versionId, templateId, version, input.changelog || '', readme, pkgPath, size, sha,
      packageFiles.length, project.tech_stack, verStatus]
  );

  console.log(`[market] 发布模板 ${slug}@${version}（${packageFiles.length} 文件，${(size / 1024 / 1024).toFixed(2)}MB, ${visibility}）`);
  return {
    template: { id: templateId, slug, name, visibility, status: tplStatus },
    version: { id: versionId, version, status: verStatus, pkg_sha256: sha, pkg_size: size, file_count: packageFiles.length },
    scanStats: scan.stats,
    // ★ 扫描命中不阻断发布：命中项作为警告随响应返回，前端提示用
    scanWarnings: scan.findings,
    scanTruncated: !!scan.truncated,
  };
}

// ─────────────────────────────────────────────────────────────
// 安装：市场模板 → 新项目
// ─────────────────────────────────────────────────────────────

/** 安全解包（复用 import-zip 已验证逻辑：拒绝路径穿越 / 绝对路径 / 符号链接） */
async function extractZipSafe(zipPath, destDir) {
  const unzipper = (await import('unzipper')).default;
  await new Promise((resolve, reject) => {
    const MAX_ENTRIES = 100000;
    const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024;
    let entryCount = 0;
    let totalBytes = 0;
    const stream = fs.createReadStream(zipPath).pipe(unzipper.Parse());
    stream.on('entry', (entry) => {
      entryCount++;
      if (entryCount > MAX_ENTRIES) {
        entry.autodrain();
        return reject(new Error(`ZIP 条目数超过 ${MAX_ENTRIES} 上限`));
      }
      const raw = entry.path;
      const normalized = raw.replace(/\\/g, '/');
      if (normalized.includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
        entry.autodrain();
        return reject(new Error(`ZIP 含非法路径: ${raw.slice(0, 80)}`));
      }
      if (entry.type === 'Directory' || entry.type === 'SymbolicLink') {
        entry.autodrain();
        return;
      }
      const dest = path.join(destDir, normalized);
      if (!dest.startsWith(destDir + path.sep)) {
        entry.autodrain();
        return reject(new Error(`ZIP 路径逃逸被拦截: ${raw.slice(0, 80)}`));
      }
      totalBytes += entry.vars.uncompressedSize || 0;
      if (totalBytes > MAX_TOTAL_BYTES) {
        entry.autodrain();
        return reject(new Error('ZIP 解压总量超限'));
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      entry.pipe(fs.createWriteStream(dest));
    });
    stream.on('finish', resolve);
    stream.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });
}

/**
 * 安装模板为一键创建项目
 * @param {{ slug, version?, name, userId, isAdmin }} input
 */
export async function installTemplate(input) {
  const { slug, userId } = input;
  const name = String(input.name || '').trim();
  if (!name) throw fail(400, '项目名称不能为空');

  const { rows: tplRows } = await db.query('SELECT * FROM templates WHERE slug = $1', [slug]);
  const tpl = tplRows[0];
  if (!tpl) throw fail(404, '模板不存在');
  if (tpl.status === 'archived') throw fail(410, '模板已下架');

  const isAuthor = tpl.author_id === userId;
  const isAdmin = !!input.isAdmin;
  const canInstall =
    tpl.source_type === 'official' ||
    (tpl.visibility === 'public' && tpl.status === 'published') ||
    isAuthor || isAdmin;
  if (!canInstall) throw fail(403, '无权安装该模板');

  // 选版本：指定 → 校验；缺省 → 最新可用（approved；作者/管理员可装自己的 pending）
  let ver;
  if (input.version) {
    const { rows } = await db.query(
      'SELECT * FROM template_versions WHERE template_id = $1 AND version = $2',
      [tpl.id, input.version]
    );
    ver = rows[0];
    if (!ver) throw fail(404, `版本 ${input.version} 不存在`);
  } else {
    const { rows } = await db.query(
      `SELECT * FROM template_versions WHERE template_id = $1
         AND (status = 'approved' OR $2)
       ORDER BY created_at DESC LIMIT 1`,
      [tpl.id, isAuthor || isAdmin]
    );
    ver = rows[0];
    if (!ver) throw fail(404, '模板暂无可用版本');
  }

  const id = uuid();
  const projectDir = path.join(GENERATED_DIR, id);
  fs.mkdirSync(projectDir, { recursive: true });

  if (ver.pkg_path) {
    // 用户模板：sha256 校验 + 安全解包
    if (!fs.existsSync(ver.pkg_path)) throw fail(500, '模板包文件缺失，请联系管理员');
    const sha = await sha256File(ver.pkg_path);
    if (sha !== ver.pkg_sha256) throw fail(500, '模板包完整性校验失败');
    await extractZipSafe(ver.pkg_path, projectDir);
  } else {
    // 官方目录模板：直接拷贝（沿用 projects.js 创建项目的过滤规则）
    const src = getTemplatePath(tpl.slug);
    if (!fs.existsSync(src)) throw fail(500, `官方模板目录缺失: ${tpl.slug}`);
    fs.cpSync(src, projectDir, {
      recursive: true,
      filter: (p) => {
        const base = path.basename(p);
        return base !== 'template.json' && base !== 'README.md';
      },
    });
  }

  // 与 projects.js 创建项目保持一致：doc 目录 + README 占位
  fs.mkdirSync(path.join(projectDir, 'doc'), { recursive: true });
  const docReadme = path.join(projectDir, 'doc', 'README.md');
  if (!fs.existsSync(docReadme)) {
    fs.writeFileSync(docReadme, `# ${name}\n\n项目文档目录。AI 生成的 PRD.md 和 doc/PLAN/ 开发计划会放在这里。\n`);
  }

  const techStack = ver.tech_stack || tpl.slug;
  await db.query(
    `INSERT INTO projects (id, name, description, tech_stack, app_type, owner_id, source_path, source_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'template')`,
    [id, name, tpl.description || '', techStack, tpl.app_type || 'web', userId, projectDir]
  );
  await db.query('UPDATE templates SET download_count = download_count + 1 WHERE id = $1', [tpl.id]);

  console.log(`[market] 安装模板 ${tpl.slug}@${ver.version} → 项目 ${id}（${name}）`);
  return {
    id, name,
    description: tpl.description || '',
    tech_stack: techStack,
    app_type: tpl.app_type || 'web',
    status: 'draft',
    owner_id: userId,
    source_path: projectDir,
    from_template: { slug: tpl.slug, name: tpl.name, version: ver.version },
  };
}

// ─────────────────────────────────────────────────────────────
// 官方模板同步（启动时把 templates/ 目录注册进市场）
// ─────────────────────────────────────────────────────────────

export async function syncOfficialTemplates() {
  const metas = listTemplates();
  let count = 0;
  for (const meta of metas) {
    try {
      const slug = meta.id || meta.name;
      const category = /uniapp|miniapp/.test(slug) ? 'miniapp' : 'fullstack';
      const version = meta.version || '1.0.0';
      const tplDir = getTemplatePath(slug);
      let readme = '';
      const readmePath = path.join(tplDir, 'README.md');
      if (fs.existsSync(readmePath)) readme = fs.readFileSync(readmePath, 'utf-8');

      // upsert 模板：保留 download_count / 评分（ON CONFLICT 只更新元数据）
      await db.query(
        `INSERT INTO templates
          (id, slug, name, description, app_type, author_name, source_type, visibility,
           category, tags, icon, status, latest_version)
         VALUES ($1,$2,$3,$4,$5,'Madazi 官方','official','public',$6,$7,$8,'published',$9)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, description=EXCLUDED.description, app_type=EXCLUDED.app_type,
           category=EXCLUDED.category, tags=EXCLUDED.tags, latest_version=EXCLUDED.latest_version,
           status='published', updated_at=NOW()`,
        [
          uuid(), slug, meta.name || slug, meta.description || '',
          (meta.app_types && meta.app_types[0]) || 'web',
          category, JSON.stringify(meta.modules || []), makeIcon(meta.name || slug), version,
        ]
      );
      const { rows } = await db.query('SELECT id FROM templates WHERE slug = $1', [slug]);
      const tplId = rows[0].id;
      // upsert 版本：官方版本免审核；已有同版本号则不覆盖（内容寻址包不适用）
      await db.query(
        `INSERT INTO template_versions
          (id, template_id, version, changelog, readme, tech_stack, status)
         VALUES ($1,$2,$3,$4,$5,$6,'approved')
         ON CONFLICT (template_id, version) DO NOTHING`,
        [uuid(), tplId, version, '官方内置模板', readme, meta.tech_stack || slug]
      );
      count++;
    } catch (err) {
      console.error(`[market] 官方模板同步失败 ${meta.id || meta.name}:`, err.message);
    }
  }
  console.log(`[market] 官方模板同步完成：${count}/${metas.length}`);
}

// ─────────────────────────────────────────────────────────────
// 浏览 / 详情 / 评分 / 下架
// ─────────────────────────────────────────────────────────────

export async function listMarketTemplates({ search, category, tag, sort, mine, userId, isAdmin, limit = 60, offset = 0 }) {
  const where = [];
  const params = [];
  // 参数占位符递增辅助
  let n = 0;
  const next = () => `$${++n}`;

  if (mine) {
    const p = next(); params.push(userId);
    where.push(`t.author_id = ${p}`);
  } else if (isAdmin) {
    where.push(`t.status <> 'archived'`);
  } else {
    const p = next(); params.push(userId);
    where.push(
      `(t.source_type = 'official' OR (t.visibility = 'public' AND t.status = 'published') OR t.author_id = ${p})`
    );
    where.push(`t.status <> 'archived'`);
  }
  if (search) {
    const p = next(); params.push(`%${search}%`);
    where.push(`(t.name ILIKE ${p} OR t.description ILIKE ${p} OR t.tags ILIKE ${p})`);
  }
  if (category) {
    const p = next(); params.push(category);
    where.push(`t.category = ${p}`);
  }
  if (tag) {
    const p = next(); params.push(`%"${tag}"%`);
    where.push(`t.tags ILIKE ${p}`);
  }

  const orderBy =
    sort === 'newest' ? 't.created_at DESC' :
    sort === 'rating' ? 't.rating_avg DESC NULLS LAST, t.rating_count DESC' :
    't.download_count DESC'; // popular（默认）

  const { rows } = await db.query(
    `SELECT t.* FROM templates t
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${orderBy}
     LIMIT ${parseInt(limit, 10) || 60} OFFSET ${parseInt(offset, 10) || 0}`,
    params
  );
  return rows.map((r) => ({ ...r, tags: safeParseTags(r.tags) }));
}

export async function getTemplateDetail(slug, { userId, isAdmin }) {
  const { rows } = await db.query('SELECT * FROM templates WHERE slug = $1', [slug]);
  const tpl = rows[0];
  if (!tpl) throw fail(404, '模板不存在');

  const isAuthor = tpl.author_id === userId;
  const visible =
    tpl.source_type === 'official' ||
    (tpl.visibility === 'public' && tpl.status === 'published') ||
    isAuthor || isAdmin;
  if (!visible) throw fail(404, '模板不存在');

  // 版本：作者/管理员可见全部；其他人只见 approved
  const { rows: versions } = await db.query(
    `SELECT id, version, changelog, pkg_size, file_count, tech_stack, status, review_note, created_at
     FROM template_versions WHERE template_id = $1 AND (status = 'approved' OR $2)
     ORDER BY created_at DESC`,
    [tpl.id, isAuthor || isAdmin]
  );

  // README：取最新可用版本的
  const { rows: readmeRows } = await db.query(
    `SELECT readme FROM template_versions WHERE template_id = $1 AND (status = 'approved' OR $2)
     ORDER BY created_at DESC LIMIT 1`,
    [tpl.id, isAuthor || isAdmin]
  );

  let myRating = null;
  if (userId) {
    const { rows: rr } = await db.query(
      'SELECT score, comment FROM template_ratings WHERE template_id = $1 AND user_id = $2',
      [tpl.id, userId]
    );
    myRating = rr[0] || null;
  }

  return { ...tpl, tags: safeParseTags(tpl.tags), versions, readme: readmeRows[0]?.readme || '', my_rating: myRating };
}

export async function rateTemplate(slug, { userId, score, comment }) {
  const s = parseInt(score, 10);
  if (!(s >= 1 && s <= 5)) throw fail(400, '评分需为 1-5 的整数');

  const { rows } = await db.query('SELECT id FROM templates WHERE slug = $1', [slug]);
  const tpl = rows[0];
  if (!tpl) throw fail(404, '模板不存在');

  await db.query(
    `INSERT INTO template_ratings (template_id, user_id, score, comment)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (template_id, user_id) DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment`,
    [tpl.id, userId, s, comment || null]
  );
  // 重算均值（一条 SQL，避免读改写竞态）
  await db.query(
    `UPDATE templates SET
       rating_avg = (SELECT AVG(score)::numeric(3,2) FROM template_ratings WHERE template_id = $1),
       rating_count = (SELECT COUNT(*) FROM template_ratings WHERE template_id = $1),
       updated_at = NOW()
     WHERE id = $1`,
    [tpl.id]
  );
  return { ok: true };
}

export async function archiveTemplate(slug, userId) {
  const { rows } = await db.query('SELECT * FROM templates WHERE slug = $1', [slug]);
  const tpl = rows[0];
  if (!tpl) throw fail(404, '模板不存在');
  if (tpl.source_type === 'official') throw fail(400, '官方模板不可下架');
  if (tpl.author_id !== userId) throw fail(403, '仅模板作者可下架');
  await db.query("UPDATE templates SET status = 'archived', updated_at = NOW() WHERE id = $1", [tpl.id]);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 管理员审核
// ─────────────────────────────────────────────────────────────

export async function listPendingReviews() {
  const { rows: tpls } = await db.query(
    `SELECT t.*, v.id AS version_id, v.version, v.changelog, v.pkg_size, v.file_count, v.created_at AS version_created_at
     FROM templates t JOIN template_versions v ON v.template_id = t.id
     WHERE v.status = 'pending'
     ORDER BY v.created_at ASC`
  );
  return tpls.map((r) => ({ ...r, tags: safeParseTags(r.tags) }));
}

export async function reviewVersion(templateId, versionId, { approved, reason, adminId }) {
  const { rows } = await db.query('SELECT * FROM template_versions WHERE id = $1 AND template_id = $2', [versionId, templateId]);
  const ver = rows[0];
  if (!ver) throw fail(404, '版本不存在');
  if (ver.status !== 'pending') throw fail(400, '该版本不在待审核状态');

  if (approved) {
    await db.query(
      `UPDATE template_versions SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`,
      [adminId, versionId]
    );
    // 批准即上架：模板转 published，latest_version 指向该版本
    await db.query(
      `UPDATE templates SET status='published', latest_version=$2, updated_at=NOW() WHERE id=$1`,
      [templateId, ver.version]
    );
  } else {
    await db.query(
      `UPDATE template_versions SET status='rejected', review_note=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3`,
      [reason || '', adminId, versionId]
    );
    await db.query(
      `UPDATE templates SET status='rejected', updated_at=NOW() WHERE id=$1 AND status='pending'`,
      [templateId]
    );
  }
  return { ok: true };
}
