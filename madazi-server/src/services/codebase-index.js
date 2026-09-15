/**
 * 代码库索引服务
 * - 遍历项目文件，按函数/类切片
 * - 存储到 codebase_index 表
 * - 提供 searchCodebase 工具供 AI 使用
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '../db/init.js';
import { PROJECTS_ROOT } from '../config/paths.js';

// 项目生成根目录 = 平台唯一路径源
const GENERATED_DIR = PROJECTS_ROOT;

// 支持的语言和文件后缀
const SUPPORTED_EXTENSIONS = {
  '.js': 'javascript',
  '.ts': 'typescript',
  '.jsx': 'javascript',
  '.tsx': 'typescript',
  '.vue': 'vue',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.rb': 'ruby',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
};

// 跳过的目录
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'env', '.env', 'target',
  'vendor', 'bin', 'obj', '.idea', '.vscode', 'coverage',
]);

// 单文件最大行数
const MAX_FILE_LINES = 3000;
// 单个 chunk 最大行数
const MAX_CHUNK_LINES = 80;

/**
 * 遍历项目目录，收集所有源文件
 */
function walkProjectDir(dir, basePath = '', results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkProjectDir(fullPath, relPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SUPPORTED_EXTENSIONS[ext]) {
        results.push({ fullPath, relPath, ext, language: SUPPORTED_EXTENSIONS[ext] });
      }
    }
  }
  return results;
}

/**
 * 将文件内容切分成 chunks（按函数/类边界或固定行数）
 */
function chunkFile(content, filePath, language) {
  const lines = content.split('\n');
  if (lines.length > MAX_FILE_LINES) {
    // 大文件只取前 MAX_FILE_LINES 行
    return [{
      content: lines.slice(0, MAX_FILE_LINES).join('\n'),
      lineStart: 1,
      lineEnd: MAX_FILE_LINES,
    }];
  }

  const chunks = [];
  let currentChunk = [];
  let chunkStart = 1;
  let currentDepth = 0;

  // 简单的函数/类边界检测：匹配 function/class/def/func 等关键字开头的行
  const boundaryRegex = /^\s*(export\s+)?(async\s+)?(function|class|def|func|public|private|protected|static)\s+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBoundary = boundaryRegex.test(line) && currentChunk.length > 0;

    // 到达边界或 chunk 太大时切割
    if (isBoundary || currentChunk.length >= MAX_CHUNK_LINES) {
      if (currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.join('\n'),
          lineStart: chunkStart,
          lineEnd: i,
        });
      }
      currentChunk = [line];
      chunkStart = i + 1;
    } else {
      currentChunk.push(line);
    }
  }

  // 最后一个 chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      lineStart: chunkStart,
      lineEnd: lines.length,
    });
  }

  return chunks;
}

/**
 * 从文件内容和路径提取关键词
 */
function extractKeywords(content, filePath, language) {
  const keywords = new Set();

  // 路径关键词
  const parts = filePath.split('/');
  for (const part of parts) {
    if (part.length > 2) {
      // 去后缀
      const name = part.replace(/\.[^.]+$/, '');
      // 驼峰/下划线分割
      const tokens = name.split(/(?=[A-Z])|[_\-.]/).filter(t => t.length > 2);
      keywords.add(name);
      tokens.forEach(t => keywords.add(t.toLowerCase()));
    }
  }

  // 提取函数名和类名
  const funcRegex = /(?:function|def|func|method)\s+([a-zA-Z_$][\w$]*)/g;
  const classRegex = /class\s+([a-zA-Z_$][\w$]*)/g;
  const constRegex = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)/g;

  let match;
  while ((match = funcRegex.exec(content)) !== null) keywords.add(match[1].toLowerCase());
  while ((match = classRegex.exec(content)) !== null) keywords.add(match[1].toLowerCase());
  while ((match = constRegex.exec(content)) !== null) keywords.add(match[1].toLowerCase());

  return Array.from(keywords).slice(0, 50); // 限制关键词数量
}

/**
 * 为项目构建代码库索引
 */
export async function buildCodebaseIndex(projectId) {
  const projectDir = path.join(GENERATED_DIR, projectId);
  if (!fs.existsSync(projectDir)) {
    throw new Error(`项目目录不存在: ${projectId}`);
  }

  // 收集所有源文件
  const files = walkProjectDir(projectDir);

  // 清空旧索引
  await db.query('DELETE FROM codebase_index WHERE project_id = $1', [projectId]);

  let totalChunks = 0;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file.fullPath, 'utf-8');
    } catch {
      continue;
    }

    // 跳过空文件或二进制
    if (!content || content.length > 200 * 1024) continue;

    const chunks = chunkFile(content, file.relPath, file.language);

    for (const chunk of chunks) {
      const keywords = extractKeywords(chunk.content, file.relPath, file.language);

      const id = randomUUID();
      await db.query(
        `INSERT INTO codebase_index (id, project_id, file_path, chunk_content, keywords, language, line_start, line_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, projectId, file.relPath, chunk.content, keywords, file.language, chunk.lineStart, chunk.lineEnd]
      );
      totalChunks++;
    }
  }

  return { files: files.length, chunks: totalChunks };
}

/**
 * 搜索代码库（供 AI 工具调用）
 * 使用关键词匹配 + ILIKE 全文搜索
 */
export async function searchCodebase(projectId, query, limit = 10) {
  // 将查询拆成关键词
  const queryTerms = query
    .toLowerCase()
    .split(/[\s,，。.()（）{}]+/)
    .filter(t => t.length > 2)
    .slice(0, 8);

  if (queryTerms.length === 0) {
    // 短查询直接 ILIKE
    const result = await db.query(
      `SELECT file_path, chunk_content, language, line_start, line_end
       FROM codebase_index
       WHERE project_id = $1 AND chunk_content ILIKE $2
       ORDER BY updated_at DESC
       LIMIT $3`,
      [projectId, `%${query}%`, limit]
    );
    return result.rows;
  }

  // 关键词匹配：keywords 数组包含任意查询词，或 content ILIKE
  const keywordConditions = queryTerms.map((_, i) => `$${i + 2} = ANY(keywords)`).join(' OR ');
  const contentConditions = queryTerms.map((_, i) => `chunk_content ILIKE $${i + 2 + queryTerms.length}`).join(' OR ');

  const result = await db.query(
    `SELECT file_path, chunk_content, language, line_start, line_end,
            (CASE
              WHEN ${keywordConditions} THEN 2
              ELSE 1
            END) AS relevance
     FROM codebase_index
     WHERE project_id = $1
       AND (${keywordConditions} OR ${contentConditions})
     ORDER BY relevance DESC, file_path ASC
     LIMIT $${queryTerms.length * 2 + 2}`,
    [projectId, ...queryTerms, ...queryTerms.map(t => `%${t}%`), limit]
  );

  return result.rows;
}

/**
 * 获取索引状态
 */
export async function getIndexStatus(projectId) {
  const result = await db.query(
    `SELECT
       COUNT(*) as total_chunks,
       COUNT(DISTINCT file_path) as total_files,
       MAX(updated_at) as last_indexed
     FROM codebase_index WHERE project_id = $1`,
    [projectId]
  );
  return result.rows[0];
}
