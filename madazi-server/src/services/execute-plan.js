// execute-plan.js -- 按开发计划逐模块生成代码
//
// 调用方式：从 preview.js 的 /execute-plan 路由调用
// 流程：
//   1. 读取 doc/PLAN/ 目录，解析模块列表
//   2. 逐模块：读取 PLAN 文件 -> chatStream 生成代码 -> 写文件
//   3. 全部完成后：编译检查 + 自动修复 + 生成启动脚本
//   4. 流式输出全过程

import fs from 'fs';
import path from 'path';
import { db } from '../db/init.js';
import { chatStream } from './llm.js';
import { parseGeneratedCode, checkBuild, autoFixBuild } from './generator.js';
import { generateStartScript } from './generate-start-script.js';
import { getTemplatePath, readTemplateFile, getTemplateContext } from './template.js';
import { PROJECTS_ROOT } from '../config/paths.js';

// 项目生成根目录 = 平台唯一路径源
const GENERATED_DIR = PROJECTS_ROOT;

// 解析 PLAN 目录下的模块列表
export function listPlanModules(projectDir) {
  const planDir = path.join(projectDir, 'doc', 'PLAN');
  if (!fs.existsSync(planDir)) return [];

  const files = fs.readdirSync(planDir)
    .filter(f => f.endsWith('.md') && f !== 'index.md' && /^\d+-/.test(f))
    .sort();

  return files.map(f => {
    const match = f.match(/^(\d+)-(.+)\.md$/);
    const content = fs.readFileSync(path.join(planDir, f), 'utf8');
    // 模块名优先用文件名（如「01-用户管理.md」→「用户管理」），干净可靠。
    // 注意：不能用 /^##\s+(.+)/m 取第一个二级标题——PLAN 文件的第一个 `## ` 是
    // 「## 1. 页面设计」这类章节名，会导致所有模块名都被解析成「页面设计」。
    const name = match ? match[2] : f.replace('.md', '');
    // 优先级从内容里的 [P0]/[P1]/[P2] 标记提取
    let priority = '';
    const pm = content.match(/\[(P[012])\]/i);
    if (pm) priority = pm[1].toUpperCase();
    return {
      fileName: f,
      seq: match ? match[1] : '00',
      name,
      priority,
      filePath: `doc/PLAN/${f}`,
    };
  });
}

// 逐模块执行 PLAN 生成代码
// onChunk(chunkText) -- 流式回调
// onDone(result)     -- 完成回调
// onError(err)       -- 错误回调
export async function runExecutePlan(projectId, { moduleFile, onChunk, onDone, onError } = {}) {
  let project;
  try {
    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!rows[0]) throw new Error('Project not found');
    project = rows[0];
  } catch (e) {
    onError?.(e);
    return;
  }

  let fullOutput = '';
  const emit = (text) => {
    fullOutput += text;
    onChunk?.(text);
  };

  try {
    const projectDir = project.source_path || path.join(GENERATED_DIR, projectId);
    const planDir = path.join(projectDir, 'doc', 'PLAN');

    // 获取模块列表
    let modules = listPlanModules(projectDir);
    if (modules.length === 0) {
      // 无 PLAN 不硬拦：提示可直接对话生成（PRD/需求描述也可直接驱动代码生成）
      throw new Error('未找到开发计划文件。无需先生成计划——直接在对话框描述你的需求，AI 会直接生成代码；也可先让 AI 生成 PRD/开发计划再按计划生成。');
    }

    // 如果指定了 moduleFile，只执行该模块
    if (moduleFile) {
      modules = modules.filter(m => m.fileName === moduleFile);
      if (modules.length === 0) {
        throw new Error(`未找到模块文件: ${moduleFile}`);
      }
      emit(`🔧 按计划执行：${modules[0].name}\n\n`);
    } else {
      emit(`🚀 按计划生成代码（共 ${modules.length} 个模块）\n\n`);
    }

    await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['generating', project.id]);

    // 确保模板脚手架已拷贝
    const templatePath = getTemplatePath(project.tech_stack);
    const hasTemplate = fs.existsSync(path.join(projectDir, 'backend')) || fs.existsSync(path.join(projectDir, 'frontend'));
    if (!hasTemplate && fs.existsSync(templatePath)) {
      fs.cpSync(templatePath, projectDir, { recursive: true, filter: (src) => {
        const base = path.basename(src);
        return base !== 'template.json' && base !== 'README.md';
      }});
      emit('📦 已拷贝项目模板脚手架\n\n');
    }

    const agentsMd = readTemplateFile(project.tech_stack, 'AGENTS.md') || '';
    const tplCtx = getTemplateContext(project.tech_stack);
    const tplCtxText = tplCtx
      ? `\n\n## 模板已有文件树\n${JSON.stringify(tplCtx.tree, null, 2)}\n\n## 模板关键文件内容\n${Object.entries(tplCtx.files).map(([k, v]) => `### ${k}\n\`\`\`\n${v}\n\`\`\``).join('\n')}`
      : '';

    // 读取 PRD 作为全局上下文
    const prdPath = path.join(projectDir, 'doc', 'PRD.md');
    const prdContent = fs.existsSync(prdPath) ? fs.readFileSync(prdPath, 'utf8') : (project.prd_doc || '');

    const allGeneratedFiles = [];

    // 逐模块生成代码
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      emit(`📌 [${i + 1}/${modules.length}] 正在执行「${mod.name}」的开发计划...\n\n`);

      // 读取模块 PLAN 文件
      const planContent = fs.readFileSync(path.join(planDir, mod.fileName), 'utf8');

      const messages = [
        {
          role: 'system',
          content: `You are a business code generator for the Madazi platform.
项目脚手架已经从模板拷贝好了（含可运行的 CRUD 范例 + pom.xml/package.json/Application.java）。
你只需要根据开发计划，生成该模块的业务代码文件。

Rules:
1. 只输出需要新建或覆盖的业务文件，不要重复输出脚手架文件。
2. 输出格式（严格强制）：每个文件必须用一个 fenced code block 输出，代码块**内部第一行**必须是路径注释。
   路径注释格式：代码文件用 // path: <相对路径>，yaml/sql/json 配置文件用 # path: <相对路径>。
   示例（仅演示输出格式，具体技术栈/包结构/注解一律以模板 AGENTS.md 为准）：
\`\`\`java
// path: backend/<按模板实际的包路径>/SysUser.java
package <按模板 AGENTS.md 的包结构>;

public class SysUser {
    // 按模板 AGENTS.md 规范编写
}
\`\`\`
   规则：一个代码块只对应一个文件；禁止在代码块外单独列文件清单；禁止输出没有路径注释的代码块；路径必须是完整相对路径（backend/... 或 frontend/...）。
3. ★★ 严格遵循模板的 AGENTS.md 规范：技术栈、数据库类型、持久层方式（MyBatis Mapper / JPA Repository / SQL 直连）、包结构、主键策略、代码风格，一律以 AGENTS.md 为准；禁止引入 AGENTS.md 未规定的技术栈。
4. 使用真实有意义的变量名，不要 placeholder。
5. 包含基础错误处理。
6. 非代码文本用中文回复。
7. 前端目录是 "frontend/"，后端目录是 "backend/"。
8. 前端已有 main 入口和路由配置；只需生成新的业务页面和组件。
9. 后端已有启动类和脚手架；只需按 AGENTS.md 规范生成新的业务代码（实体/持久层/服务/控制器等）。
10. ★ 主键一律用 UUID 字符串（平台统一要求），具体生成方式以模板 AGENTS.md 为准（如应用层 IdUtils 或数据库 gen_random_uuid）。
11. 前端 API 请求必须用相对路径（如 "/api/items"），不能硬编码绝对域名。
12. 不要使用 HashRouter。
13. ★ 如果业务需要新增数据表，必须在本次输出中**同时生成建表 SQL 文件**（格式 # path: sql/<表名>.sql），严格遵循模板 AGENTS.md 的建表规范（数据库方言、UUID 主键、表名/字段命名、索引、以及 sys_menu 菜单登记等要求）。`,
        },
        {
          role: 'user',
          content: `## 技术栈
${project.tech_stack}

## 全局 PRD（供参考）
${prdContent}

## 模板规范
${agentsMd}
${tplCtxText}

## 当前模块的开发计划
${planContent}

请根据以上开发计划，生成「${mod.name}」模块的业务代码文件。
只输出该模块需要的文件，不要涉及其他模块。`,
        },
      ];

      let response;
      try {
        response = await chatStream(messages, (chunk) => emit(chunk), {
          temperature: 0.2,
          max_tokens: 12000,
          streamReasoning: false,
        });

        if (!response || typeof response !== 'string') {
          throw new Error('AI 返回内容为空');
        }
      } catch (e) {
        emit(`\n⚠️ 「${mod.name}」代码生成失败：${e.message}，跳过\n\n`);
        continue;
      }

      // 解析并写入文件
      const files = parseGeneratedCode(response);
      for (const file of files) {
        const filePath = path.join(projectDir, file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content);
        allGeneratedFiles.push(file.path);
      }

      emit(`\n✅ 「${mod.name}」已生成 ${files.length} 个文件\n\n`);
    }

    // Git commit
    try {
      const { execFileSync } = await import('child_process');
      const gitA = (args) => execFileSync('git', ['-C', projectDir, ...args], { encoding: 'utf8', timeout: 10000 }).trim();
      if (!fs.existsSync(path.join(projectDir, '.git'))) {
        gitA(['init']);
        gitA(['config', 'user.email', 'ai@madazi.com']);
        gitA(['config', 'user.name', 'Madazi AI']);
        fs.writeFileSync(path.join(projectDir, '.gitignore'), 'node_modules/\ndist/\ntarget/\n*.class\n.env\n');
      }
      gitA(['add', '-A']);
      gitA(['commit', '-m', `Execute plan: ${modules.length} modules`]);
    } catch (err) {
      console.warn('[execute-plan] Git commit failed (non-critical):', err.message);
    }

    // 更新项目状态
    await db.query(
      'UPDATE projects SET status = $1, source_path = $2, updated_at = NOW() WHERE id = $3',
      ['generated', projectDir, projectId]
    );

    // ===== 编译检查 + 自动修复 =====
    emit('🔍 正在编译检查...\n');
    const buildResult = await checkBuild(projectDir);
    let buildStatus = 'passed';

    if (buildResult.success) {
      emit('✅ 编译通过\n\n');
    } else {
      emit('⚠️ 编译失败，正在自动修复...\n');
      const fixResult = await autoFixBuild(projectDir, buildResult.errors, (chunk) => emit(chunk));
      if (fixResult.success) {
        buildStatus = 'auto_fixed';
        emit('\n✅ 自动修复成功\n\n');
        allGeneratedFiles.push(...fixResult.fixedFiles);
      } else {
        buildStatus = 'failed';
        emit('\n❌ 自动修复未能解决所有问题\n\n');
      }
    }

    await db.query(
      'UPDATE projects SET status = $1, build_status = $2, updated_at = NOW() WHERE id = $3',
      [buildStatus === 'failed' ? 'failed' : 'generated', buildStatus, projectId]
    );

    // ===== 生成启动脚本 =====
    try {
      emit('📦 正在生成项目启动脚本...\n');
      const scriptResult = await generateStartScript(projectId, (chunk) => emit(chunk));
      if (scriptResult.success) {
        emit('\n✅ 启动脚本生成完成\n\n');
      } else {
        emit(`\n⚠️ 启动脚本生成失败：${scriptResult.error}\n\n`);
      }
    } catch (err) {
      console.warn('[execute-plan] generateStartScript failed:', err.message);
      emit(`\n⚠️ 启动脚本生成异常：${err.message}\n\n`);
    }

    // ===== 总结 =====
    emit('---\n\n');
    emit('## ✨ 代码生成完成\n\n');
    emit(`共执行 ${modules.length} 个模块，生成 ${allGeneratedFiles.length} 个文件。\n\n`);
    if (allGeneratedFiles.length > 0) {
      emit('### 💻 代码文件\n');
      // 去重
      [...new Set(allGeneratedFiles)].forEach(f => {
        emit(`- <file:${f}>\n`);
      });
      emit('\n');
    }
    if (buildStatus === 'passed') {
      emit('✅ 构建成功，预览已就绪。');
    } else if (buildStatus === 'auto_fixed') {
      emit('✅ 构建成功（已自动修复），预览已就绪。');
    } else {
      emit('⚠️ 构建有错误，请检查代码。');
    }

    await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['ready', project.id]);

    onDone?.({
      success: buildStatus !== 'failed',
      modifiedFiles: [...new Set(allGeneratedFiles)],
      buildStatus,
      fullOutput,
    });
  } catch (err) {
    console.error('[execute-plan] error:', err);
    await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['failed', project.id]);
    emit(`\n\n❌ 出错了：${err.message}\n`);
    onError?.(err, fullOutput);
  }
}
