/**
 * worker 插件加载器
 * 启动时扫描 worker-plugins/ 目录，动态注册插件工具
 *
 * 插件接口约定：
 *   export default {
 *     name: string,           // 工具名（LLM function calling 用）
 *     description: string,    // 工具描述（LLM 决定何时调用）
 *     parameters: object,     // JSON Schema 参数定义
 *     execute: async (args, ctx) => string  // 执行函数，返回 JSON 字符串
 *   }
 *
 * ctx 注入：
 *   - worktreePath: 本任务的 worktree 目录（文件操作根路径）
 *   - safeEmit: SSE 事件推送函数
 *   - projectId: 项目 ID
 *   - taskId: 任务 ID
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 加载插件目录下的所有插件
 * @returns {Promise<{tools: Array, handlers: Map<string, Function>, errors: Array}>}
 */
export async function loadPlugins() {
  const pluginDir = path.join(__dirname, 'worker-plugins');
  const tools = [];
  const handlers = new Map();
  const errors = [];

  // 目录不存在时静默返回（无插件场景）
  if (!fs.existsSync(pluginDir)) {
    console.log('[plugin-loader] worker-plugins/ 目录不存在，跳过插件加载');
    return { tools, handlers, errors };
  }

  const files = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  console.log(`[plugin-loader] 扫描到 ${files.length} 个插件文件`);

  for (const file of files) {
    const filePath = path.join(pluginDir, file);
    try {
      const module = await import(filePath);
      const plugin = module.default;

      // 接口校验
      if (!plugin || typeof plugin !== 'object') {
        errors.push({ file, error: '插件必须 export default 一个对象' });
        continue;
      }
      if (!plugin.name || typeof plugin.name !== 'string') {
        errors.push({ file, error: '缺少 name 字段（string）' });
        continue;
      }
      if (!plugin.description || typeof plugin.description !== 'string') {
        errors.push({ file, error: `插件 ${plugin.name} 缺少 description 字段` });
        continue;
      }
      if (!plugin.parameters || typeof plugin.parameters !== 'object') {
        errors.push({ file, error: `插件 ${plugin.name} 缺少 parameters 字段` });
        continue;
      }
      if (typeof plugin.execute !== 'function') {
        errors.push({ file, error: `插件 ${plugin.name} 缺少 execute 函数` });
        continue;
      }

      // 注册到 TOOLS（LLM function calling 格式）
      tools.push({
        type: 'function',
        function: {
          name: plugin.name,
          description: plugin.description,
          parameters: plugin.parameters,
        },
      });

      // 注册执行处理器
      handlers.set(plugin.name, plugin.execute);

      console.log(`[plugin-loader] ✓ 加载插件: ${plugin.name} (${file})`);
    } catch (e) {
      errors.push({ file, error: `加载失败: ${e.message}` });
      console.error(`[plugin-loader] ✗ 插件加载失败 ${file}: ${e.message}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[plugin-loader] ${errors.length} 个插件加载失败:`, errors.map(e => `${e.file}: ${e.error}`).join('; '));
  }

  return { tools, handlers, errors };
}

/**
 * 判断工具名是否为插件（用于 READ_ONLY_TOOLS 分类）
 * @param {string} toolName
 * @param {Map<string, Function>} pluginHandlers
 * @returns {boolean}
 */
export function isPluginTool(toolName, pluginHandlers) {
  return pluginHandlers.has(toolName);
}
