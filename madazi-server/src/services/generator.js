import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import { chatStream, chat } from './llm.js';
import { getTemplatePath, readTemplateFile, getTemplateContext } from './template.js';
import { generateStartScript } from './generate-start-script.js';
import { db } from '../db/init.js';
import { PROJECTS_ROOT } from '../config/paths.js';

// 项目生成根目录 = 平台唯一路径源（k8s=/app/generated；单机版由 start.sh 注入）
const GENERATED_DIR = PROJECTS_ROOT;
// 确保目录存在
fs.mkdirSync(GENERATED_DIR, { recursive: true });

const SYSTEM_PROMPT = `You are a business code generator for the Madazi platform.
项目脚手架已经从模板拷贝好了（含可运行的 CRUD 范例 + pom.xml/package.json/Application.java）。
你只需要根据用户需求，生成业务代码文件（页面、组件、Controller、Service、Entity）。

Rules:
1. 只输出需要新建或覆盖的业务文件，不要重复输出脚手架文件（pom.xml/package.json/Application.java/vite.config 等已经存在）。
2. 输出格式：fenced code block（\`\`\`lang 包裹），**代码块内第一行必须是路径注释**，一个文件一个代码块，按顺序一次性输出全部文件：
   - Java/JS/CSS 用 // path: <相对路径>
   - Python/YAML/Shell 用 # path: <相对路径>
   - XML/HTML/Vue 用 <!-- path: <相对路径> -->
   - SQL 用 -- path: <相对路径>
   示例：
\`\`\`java
// path: backend/madazi-system/src/main/java/com/madazi/system/domain/Demo.java
code here
\`\`\`
   注意：XML/SQL/Vue 必须用各自的注释语法（<!-- --> 或 --），不要用 //。
3. 严格遵循模板的 AGENTS.md 规范。
4. 使用真实有意义的变量名，不要 placeholder。
5. 包含基础错误处理。
6. 非代码文本用中文回复。
7. 前端目录是 "frontend/"，后端目录是 "backend/"。
8. 前端已有 main 入口和路由配置；只需生成新的业务页面和组件。
9. 后端启动类已存在；只需生成新的 Entity/Mapper(或 Repository)/Service/Controller（ORM 具体用哪种以 AGENTS.md 为准）。
10. ⚠️实体铁律（必须逐字照抄模板已有实体 SysConfig.java 的写法，不要凭记忆用标准 Madazi 风格）：
   - Entity 必须 extends BaseEntity（com.madazi.common.core.domain.BaseEntity），禁止重复声明 createBy/createTime/updateBy/updateTime/remark 字段。
   - 主键用 String 类型，字段名「业务名+Id」（如 customerId），应用层 IdUtils.fastSimpleUUID() 生成。
   - 禁止 private Long id 或任何 Long/Integer 自增主键。
   - 审计字段类型（BaseEntity 已定义）：createBy/updateBy 是 String，createTime/updateTime 是 java.util.Date——不要再自己声明，更不要写成 Long/String 混用。
11. 如果用户需求与模板范例不同，可以覆盖范例文件或新增实体，但不要删掉模板的基础配置文件。
12. 前端页面要实际调用后端 API，不要 mock 数据。

⚠️ 预览环境兼容性规则（非常重要）：
13. 前端 API 请求必须用相对路径（如 "/api/items"），不能硬编码 "http://localhost:8080" 或绝对域名。
14. 如果使用 React Router，BrowserRouter 已由平台自动注入 basename，不要手动设置 basename 属性。
15. 不要使用 HashRouter（与预览 base 路径不兼容）。
16. 前端代码不要依赖 window.location.origin 或 window.location.host，用相对路径。
17. 如果用 axios/fetch，baseURL 不要设绝对地址，留空或用 "/api" 前缀。
18. CSS 中不要用绝对路径引用资源（如 url("/logo.png")），用相对路径 url("./logo.png")。

⚠️ 套餐模式铁律（新建项目时用户从 6 个技术栈套餐中选 1，所选模板脚手架已随项目创建完整拷贝，AI 只在其上生成业务代码）：
   - 六种套餐：react+node / react-node / react-springboot / uniapp-springboot / vue-node / vue-springboot（前端框架 react/uni-app/vue × 后端框架 node/springboot 两两组合）
   - 数据库跟随模板：模板 AGENTS.md 规定什么数据库就用什么，禁止擅自更换或升级（如把 PostgreSQL 换成 MySQL）
   - 当前所有模板数据库统一为 PostgreSQL 16（127.0.0.1:5432 / appdb / postgres 无密码），生成 SQL 必须用 PG 方言（VARCHAR(64) 主键、COMMENT ON 注释、-- 行注释），禁止 MySQL 语法（反引号包围标识符、ENGINE=InnoDB、AUTO_INCREMENT、sysdate()）。

⚠️ 数据库铁律（非常重要，具体以 AGENTS.md 为准）：
19. 数据库类型、连接参数、ORM 选择（JPA/MyBatis）、主键生成方式，一律以模板 AGENTS.md 的「数据库」「后端规范」章节为准。
20. 主键一律 UUID 字符串（VARCHAR(64)），禁止自增整数主键。
21. 禁止擅自更换数据库（如把 MariaDB 改成 SQLite，或把 PostgreSQL 改成 MySQL）；AGENTS.md 写什么数据库就用什么。
22. 若 AGENTS.md 未明确数据库，默认模板用 PostgreSQL 16（appdb / postgres / 无密码 / 127.0.0.1:5432）。
23. ⛔ 禁止输出任何思考过程、推理、分析、计划、解释或总结文字（包括中英文）；禁止先写草稿再写正式版；直接一次性输出最终文件代码块。代码块内的代码必须是完整实现，禁止用 ... 省略号或占位符（XML 里禁止 <!-- ... --> 占位）。代码块外不允许出现任何其他文字。`;

const FIX_SYSTEM_PROMPT = `You are a build error fixer for the Madazi platform.
The AI-generated project has compilation or startup errors. Fix them.

Rules:
1. Read the error log carefully. Identify the root cause.
2. Only output the files that need to be changed.
3. Format: \`\`\`lang
// path: relative/file/path
code
\`\`\`
4. Keep changes minimal - only fix the errors, don't refactor.
5. Follow the existing code style.
6. Common fixes:
   - javax.* -> jakarta.* (Spring Boot 3)
   - Missing imports
   - Wrong method signatures
   - Incorrect annotations
   - SecurityConfig configuration issues
7. Respond in Chinese for non-code text.
8. 前端 API 必须用相对路径，不要硬编码 localhost 或绝对域名。
9. 不要手动设置 BrowserRouter basename（平台已自动注入）。
10. 数据库以项目 AGENTS.md 规范为准（PostgreSQL / MariaDB / MySQL 等），禁止擅自更换数据库。若 AGENTS.md 未明确，默认 PostgreSQL（127.0.0.1:5432/appdb，用户 postgres 无密码）。better-sqlite3 binding 错误按 AGENTS.md 的数据库规范替换对应驱动。
11. ⚠️ 实体修复铁律：严格遵循模板 AGENTS.md 的实体规范。若项目是 Madazi 模板（存在 backend/pom.xml 且含 madazi-system 模块）：实体必须 extends BaseEntity（com.madazi.common.core.domain.BaseEntity），主键 String 类型「业务名+Id」用 IdUtils.fastSimpleUUID() 生成，禁止 Long/Integer 自增主键；禁止重复声明 createBy/createTime/updateBy/updateTime/remark（BaseEntity 已含，createBy/updateBy 是 String，createTime/updateTime 是 java.util.Date）。若实体字段类型与 Service/Mapper 调用不一致，一律以「String 主键 + 继承 BaseEntity」为准统一修正。非 Madazi 模板（Node/React 等）按各自 AGENTS.md 规范修复，禁止套用 Madazi 规范。`;

// ============ 编译检查 ============

export async function checkBuild(projectDir) {
  const hasBackend = fs.existsSync(path.join(projectDir, 'backend/pom.xml'));
  const hasFrontend = fs.existsSync(path.join(projectDir, 'frontend/package.json'));

  const errors = [];

  // 后端编译检查（Maven）- 只在有 mvn 命令时检查
  if (hasBackend) {
    try {
      execFileSync('mvn', ['compile', '-f', path.join(projectDir, 'backend/pom.xml'), '-q'], {
        encoding: 'utf8',
        timeout: 120000,
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // 命令不存在（服务器未装 mvn）-- 跳过后端检查，不当成编译错误
      if (err.code === 'ENOENT') {
        console.log('[generator] mvn not available (ENOENT), skipping backend check');
      } else {
        const log = err.stderr || err.stdout || err.message;
        // 只记录真正的编译错误，忽略 mvn 未安装等环境问题
        if (log && !log.includes('mvn: not found') && !log.includes('command not found')) {
          errors.push({ type: 'backend', log: log.slice(-4000) }); // 限制日志大小
        } else {
          console.log('[generator] mvn not available, skipping backend check');
        }
      }
    }
  }

  // 前端 TypeScript 检查 - 不阻断（Vite 可运行有类型警告的代码）
  if (hasFrontend && fs.existsSync(path.join(projectDir, 'frontend/node_modules'))) {
    try {
      execFileSync('npx', ['tsc', '--noEmit'], {
        encoding: 'utf8',
        timeout: 60000,
        cwd: path.join(projectDir, 'frontend'),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // 只记录警告，不加入 errors（不阻断）
      console.log('[generator] TypeScript warnings:', (err.stdout || '').slice(0, 500));
    }
  }

  return { success: errors.length === 0, errors };
}

// 读取关键文件内容（用于修复 prompt）
function readKeyFiles(projectDir) {
  const keyFiles = [
    'backend/pom.xml',
    'backend/src/main/java',
    'frontend/package.json',
    'frontend/vite.config.ts',
  ];
  const result = {};
  for (const rel of keyFiles) {
    const full = path.join(projectDir, rel);
    if (fs.existsSync(full)) {
      if (fs.statSync(full).isDirectory()) {
        // 读取目录下所有 .java/.ts 文件
        const files = listFilesRecursive(full);
        for (const f of files.slice(0, 20)) { // 限制数量
          const sub = path.relative(projectDir, f);
          try {
            result[sub] = fs.readFileSync(f, 'utf8').slice(0, 3000);
          } catch {}
        }
      } else {
        try {
          result[rel] = fs.readFileSync(full, 'utf8').slice(0, 3000);
        } catch {}
      }
    }
  }
  return result;
}

function listFilesRecursive(dir) {
  const result = [];
  const walk = (d) => {
    const items = fs.readdirSync(d, { withFileTypes: true });
    for (const item of items) {
      if (item.name === 'node_modules' || item.name === 'target' || item.name === '.git') continue;
      const full = path.join(d, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else if (item.name.endsWith('.java') || item.name.endsWith('.ts') || item.name.endsWith('.tsx')) {
        result.push(full);
      }
    }
  };
  walk(dir);
  return result;
}

// 自动修复编译错误
export async function autoFixBuild(projectDir, errors, onChunk) {
  // ★ 兜底 noop，防止 chatStream 收到 undefined
  const _onChunk = onChunk || (() => {});
  _onChunk('\n\n⚠️ 编译失败，正在自动修复...\n');

  const errorLog = errors.map(e => `[${e.type}]\n${e.log}`).join('\n\n');
  const fileContents = readKeyFiles(projectDir);
  const agentsMd = fs.existsSync(path.join(projectDir, 'AGENTS.md'))
    ? fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8').slice(0, 2000)
    : '';

  const prompt = `## 项目规范（必须遵守，实体/主键写法以此为准）
${agentsMd || '(无 AGENTS.md)'}

## 编译错误
${errorLog}

## 当前代码
${JSON.stringify(fileContents, null, 2).slice(0, 8000)}

请修复以上编译错误。只输出需要修改的文件。`;

  const messages = [
    { role: 'system', content: FIX_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  const response = await chatStream(messages, _onChunk, {
    temperature: 0.1,
    max_tokens: 8000,
  });

  // 写回文件
  const files = parseGeneratedCode(response);
  for (const file of files) {
    const filePath = path.join(projectDir, file.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content);
  }

  // Git commit（如果修复了文件）
  if (files.length > 0) {
    try {
      execFileSync('git', ['-C', projectDir, 'add', '-A'], { encoding: 'utf8', timeout: 10000 });
      execFileSync('git', ['-C', projectDir, 'commit', '-m', 'Auto-fix: build errors'], { encoding: 'utf8', timeout: 10000 });
    } catch {}
  }

  // 重新编译检查
  const recheck = await checkBuild(projectDir);
  return {
    success: recheck.success,
    errors: recheck.errors,
    fixedFiles: files.map(f => f.path),
  };
}

export async function generateProject(project, onChunk) {
  const templatePath = getTemplatePath(project.tech_stack);
  const agentsMd = readTemplateFile(project.tech_stack, 'AGENTS.md') || '';
  const projectId = project.id;
  const projectDir = path.join(GENERATED_DIR, projectId);

  // ============ 1. 拷贝模板脚手架（如果项目目录还没有模板文件，就拷贝）============
  if (!fs.existsSync(templatePath)) {
    throw new Error(`模板不存在: tech_stack=${project.tech_stack}, path=${templatePath}。请先在 /app/templates/ 下放置对应模板。`);
  }
  // 检查项目目录是否已有模板（创建项目时已拷贝），没有则拷贝
  const hasTemplate = fs.existsSync(path.join(projectDir, 'backend')) || fs.existsSync(path.join(projectDir, 'frontend'));
  if (!hasTemplate) {
    fs.cpSync(templatePath, projectDir, { recursive: true, filter: (src) => {
      const base = path.basename(src);
      return base !== 'template.json' && base !== 'README.md';
    }});
    console.log(`[generator] Copied template ${project.tech_stack} -> ${projectDir}`);
  } else {
    console.log(`[generator] Template already exists in project dir, skipping copy`);
  }

  // ============ 2. AI 只生成业务代码（基于模板已有的 Item 范例做改造）============
  // 若有 PRD / 开发计划，优先用文档驱动生成
  const docCtx = (project.prd_doc || project.plan_doc)
    ? `\n\n## PRD 文档\n${project.prd_doc || '(未生成)'}\n\n## 开发计划\n${project.plan_doc || '(未生成)'}\n`
    : '';

  // ★ 获取模板上下文：文件树 + 关键文件内容
  const tplCtx = getTemplateContext(project.tech_stack);
  const tplCtxText = tplCtx
    ? `\n\n## 模板已有文件树\n${JSON.stringify(tplCtx.tree, null, 2)}\n\n## 模板关键文件内容（AI 基于这些代码改造）\n${Object.entries(tplCtx.files).map(([k, v]) => `### ${k}\n\`\`\`\n${v}\n\`\`\``).join('\n')}`
    : '';

  const userPrompt = `请基于以下需求，生成业务代码文件。
脚手架已经从模板拷贝好了，含完整的 CRUD 范例（具体结构以「模板已有文件树」为准）。你只需要根据具体业务需求，覆盖或新增业务文件。

## 应用类型
${project.app_type}

## 技术栈
${project.tech_stack}

## 功能模块
${project.modules || '基础CRUD'}

## 需求描述
${project.description}
${docCtx}
## 模板规范
${agentsMd}
${tplCtxText}

★ 生成完整性铁律：每个业务实体必须生成**完整 CRUD 文件集**，缺一不可：
- 后端：领域对象/实体、持久层接口、持久层映射文件（XML 或注解，按 AGENTS.md 的持久层方式）、服务接口、服务实现、控制器
- 前端：API 封装、列表页、表单/编辑页（路由注册按模板既有方式）
- 数据库：如需求涉及新数据表，必须**同时生成建表 SQL 文件**（# path: sql/<表名>.sql，按 AGENTS.md 建表规范：数据库方言、UUID 主键、表/字段命名、菜单 sys_menu 登记）
文件位置、命名、包结构、注解一律遵循 ## 模板规范 AGENTS.md（ORM/持久层方式以 AGENTS.md 为准）。
生成完成后自查：上述每个环节是否都有文件？缺则补全。
如果需求跟模板范例差异大，直接覆盖范例文件或新增实体。
不要重复生成 pom.xml、package.json、启动类、vite.config 等脚手架文件。`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const response = await chatStream(messages, onChunk, {
    temperature: 0.2,
    max_tokens: 16384,
    streamReasoning: false,
    continueOnTruncation: true,
  });

  // Parse and write files（覆盖到已拷贝的模板上）
  const files = parseGeneratedCode(response);

  for (const file of files) {
    const filePath = path.join(projectDir, file.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content);
  }

  // Update project status
  await db.query(
    'UPDATE projects SET status = $1, source_path = $2, updated_at = NOW() WHERE id = $3',
    ['generated', projectDir, projectId]
  );

  // Git init + initial commit
  try {
    const { execFileSync } = await import('child_process');
    const gitA = (args) => execFileSync('git', ['-C', projectDir, ...args], { encoding: 'utf8', timeout: 10000 }).trim();
    gitA(['init']);
    gitA(['config', 'user.email', 'ai@madazi.com']);
    gitA(['config', 'user.name', 'Madazi AI']);
    fs.writeFileSync(path.join(projectDir, '.gitignore'), 'node_modules/\ndist/\ntarget/\n*.class\n.env\n');
    gitA(['add', '-A']);
    gitA(['commit', '-m', 'Initial: AI generated project']);
    console.log(`[generator] Git initial commit: ${gitA(['rev-parse', '--short', 'HEAD'])}`);
  } catch (err) {
    console.warn('[generator] Git init failed (non-critical):', err.message);
  }

  // ============ 编译检查 + 自动修复 ============
  let buildStatus = 'pending';
  let buildErrors = null;

  const buildResult = await checkBuild(projectDir);
  if (buildResult.success) {
    buildStatus = 'passed';
    console.log(`[generator] Build check passed for ${projectId}`);
  } else {
    console.log(`[generator] Build check failed, attempting auto-fix for ${projectId}`);
    const fixResult = await autoFixBuild(projectDir, buildResult.errors, onChunk);
    if (fixResult.success) {
      buildStatus = 'auto_fixed';
      console.log(`[generator] Auto-fix succeeded for ${projectId}, fixed ${fixResult.fixedFiles.length} files`);
    } else {
      buildStatus = 'failed';
      buildErrors = JSON.stringify(fixResult.errors);
      console.log(`[generator] Auto-fix failed for ${projectId}`);
      onChunk?.(`\n\n❌ 编译失败，自动修复未能解决所有问题。\n错误日志：\n${fixResult.errors.map(e => e.log).join('\n').slice(0, 2000)}\n`);
    }
  }

  // 更新项目状态和编译结果
  await db.query(
    'UPDATE projects SET status = $1, source_path = $2, build_status = $3, build_errors = $4, updated_at = NOW() WHERE id = $5',
    [buildStatus === 'failed' ? 'failed' : 'generated', projectDir, buildStatus, buildErrors, projectId]
  );

  // Save generation record
  await db.query(
    'INSERT INTO generations (id, project_id, prompt, response, status) VALUES ($1, $2, $3, $4, $5)',
    [uuid(), projectId, userPrompt, response, buildStatus === 'failed' ? 'failed' : 'success']
  );

  // ============ 生成 AI 驱动的启动脚本 ============
  try {
    onChunk?.('\n\n📦 正在生成项目启动脚本...\n');
    const scriptResult = await generateStartScript(projectId, (chunk) => {
      onChunk?.(chunk);
    });
    if (scriptResult.success) {
      onChunk?.('\n✅ 启动脚本生成完成\n');
    } else {
      onChunk?.(`\n⚠️ 启动脚本生成失败（将使用内置脚本）：${scriptResult.error}\n`);
    }
  } catch (err) {
    console.warn('[generator] generateStartScript failed (non-critical):', err.message);
    onChunk?.(`\n⚠️ 启动脚本生成异常（将使用内置脚本）：${err.message}\n`);
  }

  return {
    projectId,
    fileCount: files.length,
    files: files.map(f => f.path),
    buildStatus,
    errors: buildResult.success ? null : (buildStatus === 'failed' ? JSON.parse(buildErrors) : buildResult.errors),
  };
}

export function parseGeneratedCode(text) {
  const files = [];
  const seen = new Set();
  // 匹配 ```lang\n// path: xxx\n、# path: xxx\n、-- path: xxx\n（SQL）、<!-- path: xxx -->\n（XML/HTML）
  const regex = /```\w*\n(?:\/\/|<!--|--|#|)\s*path:\s*(.+?)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    let filePath = match[1].trim();
    // 清理 XML/HTML 注释结尾（<!-- path: xxx --> 的尾部 -->）
    filePath = filePath.replace(/\s*-->\s*$/, '');
    // 清理 AI 续写标记（index.vue（续）/ index.vue(continued) 等）
    filePath = filePath.replace(/[（(]\s*(?:续|continued)\s*[）)]\s*$/i, '');
    if (!filePath || filePath.includes('path:')) continue;
    const content = match[2].replace(/\n```\s*$/, '').trim();
    // 过滤截断续写产生的短残留块（<50 字符）与格式示例
    if (content.length < 50) continue;
    // 同路径保留更长版本（AI 截断续写时会重写整个文件，短残留/续写标记块不覆盖完整块）
    if (seen.has(filePath)) {
      const idx = files.findIndex(f => f.path === filePath);
      if (idx >= 0 && content.length > files[idx].content.length) {
        files.splice(idx, 1);
        files.push({ path: filePath, content });
      }
      continue;
    }
    seen.add(filePath);
    files.push({ path: filePath, content });
  }
  return files;
}
