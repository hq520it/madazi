// initiateViaChat -- 把项目初始化（PRD/计划/代码生成）包装成 chat 协议 SSE
//
// 与原 /initiate 端点的区别：
//  - 事件协议改用 chat 的 { type: 'task_created' | 'chunk' | 'done' | 'error' }
//  - 每一步的进度文字作为 chunk 流式输出，前端 AI 对话框自然渲染
//  - 把 AI 生成的完整内容（PRD/PLAN/代码）作为 chunk 追加输出，让用户看到全过程
//  - 完成后把整个过程的摘要存入 conversation.ai_messages 作为一条 AI 消息
//
// 调用方式：在 POST /:id/chat 路由里识别 message==='[INITIATE_PROJECT]' 或 mode==='initiate'

import fs from 'fs';
import path from 'path';
import { db } from '../db/init.js';
import { chat, chatStream } from './llm-via-dsh.js'; // ★ P2：文档链路走 dsh pod，与 server 解耦
import {
  addAiMessage,
  updateAiMessage,
  appendAiContent,
} from './conversations.js';

// ===== 公共：按功能模块生成开发计划（写 doc/PLAN/ 多文件 + index.md + 更新 plan_doc）=====
// emit(text)          -- 人类可读进度文本（不含标记）
// onModuleStart({seq, name}) -- 每个模块开始时回调（供调用方包装前端标记）
// onModuleDone({seq, name, fileName}) -- 每个模块完成时回调
// 返回 { plan, modules, planParts }
export async function generateModularPlan({ project, prd, emit, onModuleStart, onModuleDone, onModulesTotal }) {
  // ===== Step 3: 功能拆分 =====
  emit('🔀 正在分析功能模块...\n\n');
  const modulesResp = await chat(
    [
      {
        role: 'system',
        content: `从 PRD 的功能清单中提取功能模块。返回纯 JSON 数组，不要 markdown 代码块，不要解释。
格式：[{"name":"模块名","priority":"P0"}]
priority 必须是 P0/P1/P2。按优先级排序，P0 在前。`,
      },
      {
        role: 'user',
        content: `PRD：\n${prd}\n\n请提取功能模块列表。`,
      },
    ],
    { temperature: 0.2, max_tokens: 2000, projectId: project.id }, // ★ P2：走 dsh pod
  );

  let modules;
  try {
    // 兜底：去掉可能的 ```json 围栏
    const clean = modulesResp.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim();
    modules = JSON.parse(clean);
    if (!Array.isArray(modules) || modules.length === 0) throw new Error('空数组');
  } catch (e) {
    // 兜底：从 PRD 功能清单按行提取
    console.warn('[generateModularPlan] module parse failed, fallback:', e.message);
    const lines = prd.split('\n').filter((l) => /^\s*[-*]\s+.+\[(?:P0|P1|P2)\]/i.test(l));
    modules = lines.map((l) => {
      const m = l.match(/^(?:\s*[-*]\s+)(.+?)\s*\[(P[012])\]/i);
      return m ? { name: m[1].trim(), priority: m[2].toUpperCase() } : null;
    }).filter(Boolean);
    if (modules.length === 0) {
      throw new Error('功能拆分失败：无法从 PRD 提取功能模块');
    }
  }

  // 下发总模块清单（含 name/priority，前端据此渲染完整任务列表 + "待生成"占位）
  onModulesTotal?.(modules.map((m, i) => ({ seq: String(i + 1).padStart(2, '0'), name: m.name, priority: m.priority })));

  emit(`📋 共识别 ${modules.length} 个功能模块：\n`);
  modules.forEach((m, i) => {
    emit(`  ${i + 1}. ${m.name} [${m.priority}]\n`);
  });
  emit('\n');

  // ===== Step 4: 逐个功能生成 PLAN =====
  const planDir = path.join(project.source_path || '', 'doc', 'PLAN');
  try {
    if (project.source_path) {
      fs.mkdirSync(planDir, { recursive: true });
    }
  } catch (e) { console.error('[generateModularPlan] mkdir PLAN error:', e.message); }

  const planParts = [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const seq = String(i + 1).padStart(2, '0');
    onModuleStart?.({ seq, name: mod.name, priority: mod.priority });
    emit(`🗓️  [${i + 1}/${modules.length}] 正在生成「${mod.name}」的开发计划...\n\n`);

    let modPlan = '';
    try {
      modPlan = await chatStream(
        [
          {
            role: 'system',
            content: `你是技术负责人。基于 PRD，为指定功能模块生成开发计划。
Markdown 格式，包含以下章节：
1. 页面设计（本模块涉及的页面及组件）
2. 数据模型（本模块的数据库表 DDL，不含认证/权限等模板表）
3. 接口设计（本模块的 CRUD + 业务接口，含请求/响应格式）
4. 开发步骤（按顺序列出实现步骤）

技术栈 ${project.tech_stack} 的基础脚手架(pom.xml/package.json/Application.java/vite.config)模板已有。
用户认证、权限管理、状态机、编码规则由模板自带，不要重复。
只生成本模块的内容，不要涉及其他模块。
直接输出 Markdown，不要多余解释。`,
          },
          {
            role: 'user',
            content: `项目：${project.name}\n技术栈：${project.tech_stack}\n模块：${mod.name}（优先级 ${mod.priority}）\n\n完整 PRD（供参考）：\n${prd}\n\n请生成「${mod.name}」的开发计划。`,
          },
        ],
        (chunk) => emit(chunk),
        { temperature: 0.3, max_tokens: 16000, streamReasoning: false, continueOnTruncation: true, projectId: project.id }, // ★ P2：走 dsh pod
      );

      if (!modPlan || typeof modPlan !== 'string') {
        throw new Error('AI 返回内容为空');
      }
      modPlan = modPlan.replace(/^```(?:markdown|md)\s*\n/i, '').replace(/\n```\s*$/i, '').trim();
    } catch (e) {
      emit(`\n⚠️ 「${mod.name}」开发计划生成失败：${e.message}，跳过\n\n`);
      continue;
    }

    // 写分模块文件
    const safeName = mod.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_');
    const fileName = `${seq}-${safeName}.md`;
    try {
      if (project.source_path) {
        fs.writeFileSync(path.join(planDir, fileName), modPlan);
      }
    } catch (e) { console.error('[generateModularPlan] write PLAN/' + fileName + ' error:', e.message); }

    planParts.push(`## ${seq}. ${mod.name} [${mod.priority}]\n\n${modPlan}`);
    emit(`\n✅ 「${mod.name}」开发计划已生成（doc/PLAN/${fileName}）\n\n`);
    onModuleDone?.({ seq, name: mod.name, priority: mod.priority, fileName });
  }

  // 合并完整 PLAN + 索引
  const plan = `# 开发计划\n\n> 按功能模块拆分，共 ${modules.length} 个模块。\n\n` + planParts.join('\n\n---\n\n');

  // 写索引文件
  let indexContent = `# 开发计划索引\n\n共 ${modules.length} 个功能模块：\n\n`;
  planParts.forEach((_, i) => {
    const mod = modules[i];
    const seq = String(i + 1).padStart(2, '0');
    const safeName = mod.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_');
    indexContent += `- [${seq}. ${mod.name} [${mod.priority}]](${seq}-${safeName}.md)\n`;
  });
  try {
    if (project.source_path) {
      fs.writeFileSync(path.join(planDir, 'index.md'), indexContent);
    }
  } catch (e) { console.error('[generateModularPlan] write PLAN index error:', e.message); }

  await db.query('UPDATE projects SET plan_doc = $1 WHERE id = $2', [plan, project.id]);
  emit(`✅ 开发计划已生成（共 ${modules.length} 个模块）\n\n`);
  return { plan, modules, planParts };
}

// 运行项目初始化流程，把进度通过 onChunk 回调推送（chat 协议格式）
// onChunk(chunkText) -- 每次进度/内容文字
// onDone(result)     -- 完成回调
// onError(err)       -- 错误回调
export async function runInitiateViaChat(projectId, { onChunk, onDone, onError }) {
  let project;
  try {
    const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!rows[0]) throw new Error('Project not found');
    project = rows[0];
  } catch (e) {
    onError?.(e);
    return;
  }

  await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['generating', project.id]);

  // 累积所有输出文本，结束时存入 conversation
  let fullOutput = '';

  const emit = (text) => {
    fullOutput += text;
    onChunk?.(text);
  };

  try {
    let prd = project.prd_doc;
    let plan = project.plan_doc;
    // ★ 块外声明，供 Step 5 统计模块数（复用已有 PLAN 时也要有值）
    let planParts = [];

    const hasPrd = !!(prd && prd.trim());
    const hasPlan = !!(plan && plan.trim());

    // ===== 三级检测：已有文档直接复用，缺什么补什么，绝不重写已有内容 =====
    if (hasPrd && hasPlan) {
      emit('📄 检测到已有 PRD 和开发计划文档，直接按计划生成代码...\n\n');
      emit('✅ 使用已有 PRD 文档（doc/PRD.md）\n');
      emit('✅ 使用已有开发计划（doc/PLAN/）\n\n');
    } else {
      // ===== 补 PRD（已有则复用，不重写）=====
      if (!hasPrd) {
      // ===== Step 1: 自动推断需求（跳过提问）=====
      emit('🤔 正在分析你的项目需求...\n\n');

      const inferMsg = [
        {
          role: 'system',
          content: `你是产品经理。根据项目描述，列出 3-5 个关键问题并给出最合理的默认答案。
每行格式：问题 -> 答案。答案要具体、可执行。`,
        },
        {
          role: 'user',
          content: `项目名称：${project.name}\n技术栈：${project.tech_stack}\n功能模块：${project.modules || '未指定'}\n需求描述：${project.description}\n\n请列出关键问题并给出默认答案。`,
        },
      ];
      const qaResp = await chat(inferMsg, { temperature: 0.4, max_tokens: 1200, projectId }); // ★ P2：走 dsh pod
      const qaLines = qaResp.split('\n').filter((l) => l.includes('->'));
      const questions = qaLines.map((l) => l.split('->')[0].trim());
      const answers = qaLines.map((l) => l.split('->').slice(1).join('->').trim());

      emit('📋 需求问答：\n');
      questions.forEach((q, i) => {
        emit(`• ${q} -> ${answers[i] || '(自动推断)'}\n`);
      });
      emit('\n');

      // ===== Step 2: 生成精简 PRD =====
      emit('📝 正在撰写 PRD 文档...\n\n');

      const qaText = questions
        .map((q, i) => `Q: ${q}\nA: ${answers[i] || '(未回答)'}`)
        .join('\n\n');

      prd = await chatStream(
        [
          {
            role: 'system',
            content: `你是产品经理 + 技术架构师。基于项目描述和问答，生成精简 PRD。
用 Markdown 格式，只包含以下 5 个章节：
1. 项目概述
2. 用户角色
3. 功能清单（带优先级 P0/P1/P2，每个功能一行：- 功能名 [P0/P1/P2] - 简要说明）
4. 页面清单
5. 数据模型（全局表关系，只列业务实体表，不含认证/权限等模板已覆盖的表）

注意：用户认证、权限管理、状态机、编码规则、非功能需求由项目模板自带，不要在 PRD 中重复。
接口清单不需要，会放到各功能的开发计划中。
直接输出 Markdown，不要多余解释。`,
          },
          {
            role: 'user',
            content: `项目名称：${project.name}\n技术栈：${project.tech_stack}\n功能模块：${project.modules || '未指定'}\n需求描述：${project.description}\n\n问答：\n${qaText}\n\n请生成 PRD。`,
          },
        ],
        (chunk) => emit(chunk),
        { temperature: 0.3, max_tokens: 16000, streamReasoning: false, projectId }, // ★ P2：走 dsh pod
      );

      // strip AI 可能加的 ```markdown 围栏（会导致预览显示原始标记）
      if (!prd || typeof prd !== 'string') {
        throw new Error('AI 返回 PRD 内容为空，请检查模型配置或重试');
      }
      prd = prd.replace(/^```(?:markdown|md)\s*\n/i, '').replace(/\n```\s*$/i, '').trim();

      await db.query('UPDATE projects SET prd_doc = $1 WHERE id = $2', [prd, project.id]);
      // ★ 同步写磁盘 doc/PRD.md（与 brainstorm 路由一致，刷新后文件树可见）
      try {
        if (project.source_path) {
          fs.mkdirSync(path.join(project.source_path, 'doc'), { recursive: true });
          fs.writeFileSync(path.join(project.source_path, 'doc', 'PRD.md'), prd);
        }
      } catch (e) { console.error('[initiateViaChat] write PRD.md error:', e.message); }
      emit('\n✅ PRD 已生成\n\n');
      } else {
        emit('✅ 使用已有 PRD 文档（doc/PRD.md）\n\n');
      }

      // ===== 补 PLAN（已有则复用，不重写）=====
      if (!hasPlan) {
      // ===== Step 3+4: 功能拆分 + 逐模块生成 PLAN（公共函数，产出 doc/PLAN/ 多文件）=====
      const genResult = await generateModularPlan({
        project, prd, emit,
        onModuleStart: ({ seq, name }) => emit(`<<<PLAN_MOD_START|${seq}|${name}>>>\n`),
        onModuleDone: () => emit('<<<PLAN_MOD_END>>>\n'),
        onModulesTotal: (mods) => emit(`<<<PLAN_MOD_TOTAL|${JSON.stringify(mods)}>>>\n`),
      });
      planParts = genResult.planParts;
      plan = genResult.plan;
      } else {
        emit('✅ 使用已有开发计划（doc/PLAN/）\n\n');
        // ★ 复用分支：从 doc/PLAN/ 目录统计模块数（供 Step 5 展示）
        try {
          if (project.source_path && fs.existsSync(path.join(project.source_path, 'doc', 'PLAN'))) {
            planParts = fs.readdirSync(path.join(project.source_path, 'doc', 'PLAN'))
              .filter(f => f.endsWith('.md') && f !== 'index.md' && /^\d+-/.test(f))
              .sort();
          }
        } catch (e) { console.error('[initiateViaChat] count PLAN modules error:', e.message); }
      }
    }

    // ===== Step 5: 等待用户选择 =====
    emit('\n\n---\n\n');
    emit('## 📋 开发计划已生成\n\n');
    emit(`共 ${planParts?.length || 0} 个功能模块，文档已保存到 doc/PLAN/。\n\n`);
    emit('请选择下一步：\n');
    emit('- 📝 **调整计划** -- 在编辑器中修改 doc/PLAN/ 下的文件\n');
    emit('- 🚀 **按计划生成代码** -- 逐模块自动生成代码并构建预览\n');
    emit('\n输入 `/execute-plan` 可随时按计划生成代码。');

    await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['plan_ready', project.id]);

    onDone?.({
      success: true,
      prd,
      plan,
      awaitChoice: true,
      modifiedFiles: [],
      fullOutput,
    });
  } catch (err) {
    console.error('[initiateViaChat] error:', err);
    await db.query('UPDATE projects SET status = $1 WHERE id = $2', ['failed', project.id]);
    emit(`\n\n❌ 出错了：${err.message}\n`);
    onError?.(err, fullOutput);
  }
}

// 把整个初始化过程的输出存为一条 AI 消息（供会话历史回看）
export async function saveInitiateAsAiMessage(conversationId, taskId, fullOutput, result) {
  try {
    const aiMsgId = await addAiMessage(conversationId, taskId);
    if (fullOutput) {
      await appendAiContent(aiMsgId, fullOutput);
    }
    await updateAiMessage(aiMsgId, {
      status: 'completed',
      content: fullOutput,
      modifiedFiles: result?.modifiedFiles || [],
    });
    return aiMsgId;
  } catch (e) {
    console.warn('[initiateViaChat] saveAiMessage failed:', e.message);
    return null;
  }
}
