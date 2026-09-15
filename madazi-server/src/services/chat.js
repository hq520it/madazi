import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { chatStream } from './llm.js';
import { db } from '../db/init.js';
import { getPreview } from './preview.js';
import { getPreviewPodLogs } from './preview-k8s.js';
import { execPreviewPodCommand } from './terminal-k8s.js';
import { v4 as uuid } from 'uuid';

const SYSTEM_PROMPT = `You are a code fixer for the Madazi platform.
The user has a generated project and wants to modify or fix it.

Rules:
1. Output code in fenced code blocks with the file path as a comment on the first line.
2. Format: \`\`\`lang
// path: relative/file/path
code
\`\`\`
3. Only output the files that need to be changed, not all files.
4. Keep changes minimal - only fix/modify what the user asked.
5. Follow the existing code style in the project.
6. Respond in Chinese for any non-code text.
7. If there are build errors, read the error log and fix accordingly.

⚠️ 预览环境知识（诊断问题时参考）：
8. 项目运行在 Docker 容器中，Vite dev server 监听 5173 端口。
9. 预览 URL 格式：https://pv-<id8>.<域>/（短 URL，vite base=/，直接打开应用；API 走相对 /api）
10. React Router 的 BrowserRouter basename 已由平台自动注入，不要手动设置。
11. 前端 API 请求必须用相对路径（如 "/api/items"），不能硬编码 localhost 或绝对域名。
12. 如果用户报告"空白页面"，常见原因：
    a. BrowserRouter 手动设置了 basename 导致路由不匹配
    b. API 请求硬编码了 localhost 导致请求失败
    c. React 组件渲染报错（检查控制台是否有 JS 错误）
    d. 路由路径配置错误（如 /login 但没有 LoginComponent）
13. 如果用户报告"接口 404"，检查前端 API 路径是否与后端 Controller @RequestMapping 一致。
14. 修复后代码会自动写入并触发 Vite HMR 热更新，无需手动刷新。`;

export { SYSTEM_PROMPT };

// ============ Git 工具函数 ============

export function gitArgs(sourcePath, args) {
  return execFileSync('git', ['-C', sourcePath, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  }).trim();
}

export function gitInit(sourcePath) {
  if (!fs.existsSync(path.join(sourcePath, '.git'))) {
    gitArgs(sourcePath, ['init']);
    gitArgs(sourcePath, ['config', 'user.email', 'ai@madazi.com']);
    gitArgs(sourcePath, ['config', 'user.name', 'Madazi AI']);
    const gitignore = 'node_modules/\ndist/\ntarget/\n*.class\n.env\n';
    fs.writeFileSync(path.join(sourcePath, '.gitignore'), gitignore);
  }
}

export function gitCommit(sourcePath, message) {
  gitArgs(sourcePath, ['add', '-A']);
  try {
    gitArgs(sourcePath, ['commit', '-m', message.slice(0, 72)]);
    return gitArgs(sourcePath, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

function gitLog(sourcePath, maxCount = 50) {
  try {
    const log = gitArgs(sourcePath, [
      'log', `--max-count=${maxCount}`,
      '--pretty=format:%H|%an|%ad|%s', '--date=iso-strict',
    ]);
    return log.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, ...msgParts] = line.split('|');
      return { hash, author, date, message: msgParts.join('|') };
    });
  } catch {
    return [];
  }
}

function gitDiff(sourcePath, hash) {
  try {
    return gitArgs(sourcePath, ['diff', hash, 'HEAD']);
  } catch {
    return '';
  }
}

function gitCheckout(sourcePath, hash) {
  gitArgs(sourcePath, ['stash']);
  gitArgs(sourcePath, ['checkout', hash, '--', '.']);
  gitArgs(sourcePath, ['commit', '-am', `Rollback to ${hash.slice(0, 8)}`]);
}

// ============ HMR 触发 ============

export async function triggerHMR(projectId, sourcePath, modifiedFiles) {
  if (modifiedFiles.length === 0) return;
  try {
    const preview = getPreview(projectId);
    if (!preview?.podIP) return;

    const projectDirName = path.basename(sourcePath);
    // ★ K8s：Pod 内 git checkout -- . 重写文件，触发 inotify → Vite HMR
    const { code, output } = await execPreviewPodCommand(projectId, `cd /data/${projectDirName} && git checkout -- .`, { projectDirName });
    if (code === 0) {
      console.log(`[chat] git checkout -- . triggered HMR in preview-${projectId.slice(0, 8)}`);
    } else {
      console.warn(`[chat] HMR exec failed (${code}): ${output.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn('[chat] HMR trigger failed (non-critical):', err.message);
  }
}

// ============ 对话修改主流程 ============

export async function chatModify(projectId, message, onChunk) {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]) throw new Error('Project not found');
  if (!rows[0].source_path) throw new Error('Project not generated yet');

  const sourcePath = rows[0].source_path;

  // 确保 git 已初始化
  gitInit(sourcePath);

  // 读取当前文件列表
  const fileList = listFiles(sourcePath).join('\n');

  // 如果有预览日志，附上
  let errorContext = '';
  try {
    const { logs } = await getPreviewPodLogs(projectId, 100);
    if (logs) {
      errorContext = `\n\n## 预览容器日志（最后100行）\n\`\`\`\n${logs}\n\`\`\``;
    }
  } catch {}

  // 读取关键文件内容（限制总大小）
  const fileContents = await readKeyFiles(sourcePath);

  const userPrompt = `## 当前项目文件列表
${fileList}

## 当前代码内容
${fileContents}
${errorContext}

## 用户要求
${message}

请根据用户要求修改代码。只输出需要修改的文件。`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const response = await chatStream(messages, onChunk, {
    temperature: 0.2,
    max_tokens: 8000,
  });

  // 解析并写入修改的文件
  const files = parseGeneratedCode(response);
  const modifiedFiles = [];
  for (const file of files) {
    const filePath = path.join(sourcePath, file.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content);
    modifiedFiles.push(file.path);
  }

  // Git commit
  let commitHash = null;
  if (modifiedFiles.length > 0) {
    commitHash = gitCommit(sourcePath, message.slice(0, 72));
    console.log(`[chat] Git commit: ${commitHash?.slice(0, 8)} (${modifiedFiles.length} files)`);
  }

  // 触发 Vite HMR：在预览容器内 git checkout -- . 重写文件 → inotify
  await triggerHMR(projectId, sourcePath, modifiedFiles);

  // 保存对话记录
  await db.query(
    'INSERT INTO generations (id, project_id, prompt, response, status) VALUES ($1, $2, $3, $4, $5)',
    [uuid(), projectId, message, response, 'success']
  );

  return { modifiedFiles, response, commitHash };
}

// ============ 版本历史 API ============

export function getProjectHistory(projectId) {
  const { rows } = db.querySync ? null : null; // placeholder
}

export async function getHistory(projectId) {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]?.source_path) return [];
  return gitLog(rows[0].source_path);
}

export async function getCommitDiff(projectId, hash) {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]?.source_path) return [];
  const sourcePath = rows[0].source_path;

  try {
    // 获取该 commit 修改的文件列表
    const rawFiles = gitArgs(sourcePath, ['diff-tree', '--no-commit-id', '--name-only', '-r', hash]).trim();
    if (!rawFiles) return [];
    const files = rawFiles.split('\n').filter(Boolean);

    const result = [];
    for (const f of files) {
      try {
        let oldContent = '';
        let isNew = false;
        try {
          oldContent = gitArgs(sourcePath, ['show', `${hash}^:${f}`]);
        } catch {
          isNew = true;
        }
        const newContent = gitArgs(sourcePath, ['show', `${hash}:${f}`]);
        result.push({ path: f, oldContent, newContent, isNew });
      } catch {}
    }
    return result;
  } catch {
    return [];
  }
}

export async function rollbackToCommit(projectId, hash) {
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]?.source_path) throw new Error('Project not generated');

  gitCheckout(rows[0].source_path, hash);

  // 触发 HMR
  await triggerHMR(projectId, rows[0].source_path, ['.']);

  return { ok: true, hash };
}

// ============ 辅助函数 ============

export function listFiles(dir, base = '') {
  const items = [];
  if (!fs.existsSync(dir)) return items;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'target') continue;
    const fullPath = path.join(dir, name);
    const relPath = base ? base + '/' + name : name;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      items.push(...listFiles(fullPath, relPath));
    } else {
      items.push(relPath);
    }
  }
  return items;
}

export async function readKeyFiles(dir) {
  const files = listFiles(dir);
  const keyPatterns = /\.(tsx?|jsx?|vue|css|html|json|yml|yaml|java|properties)$/;
  let content = '';
  let totalSize = 0;
  const MAX_SIZE = 30000;

  for (const file of files) {
    if (!keyPatterns.test(file)) continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.size > 5000) continue;
    if (totalSize + stat.size > MAX_SIZE) break;

    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    content += `\n### ${file}\n\`\`\`\n${fileContent}\n\`\`\`\n`;
    totalSize += stat.size;
  }
  return content || '(no files found)';
}

export function parseGeneratedCode(text) {
  const files = [];
  const regex = /```\w+\n\/\/ path: (.+?)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    files.push({
      path: match[1].trim(),
      content: match[2].trim(),
    });
  }
  return files;
}
