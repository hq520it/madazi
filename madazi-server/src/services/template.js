import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ★ P3：模板运行时权威放共享 PVC（server pod 的 templates-init initContainer 启动同步 + 版本门控）。
//   镜像内 /app/templates 仅作种子/回退；PVC 未同步（本地 dev、首次部署前）回退镜像，避免建项目失败。
const PVC_TEMPLATES_DIR = process.env.TEMPLATES_DIR_PVC || '/data/.madazi-templates';
const IMAGE_TEMPLATES_DIR = path.join(__dirname, '../../templates');

function pickTemplatesDir() {
  try {
    if (fs.existsSync(PVC_TEMPLATES_DIR)) {
      const hasTemplate = fs.readdirSync(PVC_TEMPLATES_DIR).some((e) =>
        fs.statSync(path.join(PVC_TEMPLATES_DIR, e)).isDirectory()
      );
      if (hasTemplate) return PVC_TEMPLATES_DIR;
    }
  } catch { /* PVC 不可用（本地 dev 无挂载），走镜像 */ }
  return IMAGE_TEMPLATES_DIR;
}

const TEMPLATES_DIR = pickTemplatesDir();

export function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(d => fs.statSync(path.join(TEMPLATES_DIR, d)).isDirectory())
    .map(name => {
      const metaPath = path.join(TEMPLATES_DIR, name, 'template.json');
      let meta = { name, id: name };
      if (fs.existsSync(metaPath)) {
        meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) };
      }
      return meta;
    });
}

export function getTemplatePath(templateId) {
  // 归一化：react+springboot -> react-springboot（兼容旧数据）
  const normalized = templateId.replace(/\+/g, '-');
  return path.join(TEMPLATES_DIR, normalized);
}

export function readTemplateFile(templateId, relPath) {
  const normalized = templateId.replace(/\+/g, '-');
  const fullPath = path.join(TEMPLATES_DIR, normalized, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * 获取模板的完整上下文：文件树 + 关键文件内容
 * 用于注入 AI prompt，让 AI 知道模板里具体有什么
 */
export function getTemplateContext(templateId) {
  const templatePath = getTemplatePath(templateId);
  if (!fs.existsSync(templatePath)) return null;

  // 1. 文件树
  const tree = buildTree(templatePath);

  // 2. 关键文件内容（限制大小）
  const keyFiles = {};
  // Madazi 模板（backend/pom.xml 多模块 Maven）用 Madazi 范例文件；否则用默认 Node/React 范例
  const isMadazi = fs.existsSync(path.join(templatePath, 'backend/pom.xml'));
  const targets = isMadazi ? [
    'AGENTS.md',
    'backend/pom.xml',
    'backend/madazi-admin/src/main/resources/application.yml',
    'backend/madazi-admin/src/main/java/com/madazi/web/controller/system/SysConfigController.java',
    'backend/madazi-system/src/main/java/com/madazi/system/domain/SysConfig.java',
    'backend/madazi-system/src/main/java/com/madazi/system/mapper/SysConfigMapper.java',
    'backend/madazi-system/src/main/java/com/madazi/system/service/impl/SysConfigServiceImpl.java',
    'backend/madazi-system/src/main/resources/mapper/system/SysConfigMapper.xml',
    'frontend/package.json',
    'frontend/vite.config.js',
    'frontend/src/main.js',
    'frontend/src/utils/request.js',
    'frontend/src/api/system/config.js',
    'frontend/src/views/system/config/index.vue',
  ] : [
    'AGENTS.md',
    'backend/package.json',
    'backend/src/index.ts',
    'backend/src/db.ts',
    'backend/src/routes/items.ts',
    'frontend/package.json',
    'frontend/vite.config.ts',
    'frontend/src/main.tsx',
    'frontend/src/App.tsx',
    'frontend/src/api.ts',
    'frontend/src/pages/Home.tsx',
  ];
  for (const rel of targets) {
    const full = path.join(templatePath, rel);
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, 'utf-8');
      keyFiles[rel] = content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content;
    }
  }

  return { tree, files: keyFiles };
}

function buildTree(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  const items = fs.readdirSync(dir);
  return items
    .filter(name => name !== 'node_modules' && name !== '.git' && name !== 'dist' && name !== 'target')
    .map(name => {
      const fullPath = path.join(dir, name);
      const relPath = base ? base + '/' + name : name;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return { name, path: relPath, type: 'dir', children: buildTree(fullPath, relPath) };
      }
      return { name, path: relPath, type: 'file', size: stat.size };
    });
}
