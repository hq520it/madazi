/**
 * Docker 构建服务 - 方案C 核心
 * 负责构建预览镜像、运行预览容器、AI 优化循环
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { db } from '../db/init.js';
import { chatStream } from './llm.js';
import { publish } from './bus.js';

// 模板目录（madazi-server 服务器上）
const TEMPLATE_DIR = process.env.TEMPLATE_DIR || path.join(process.cwd(), 'preview-templates');

// 构建日志存储（projectId -> { logs: string, status: 'building'|'done'|'error', listeners: Set }）
export const buildLogStore = new Map();

/**
 * 向构建日志存储追加日志行（本地存储操作，单副本语义）
 */
export function appendBuildLog(projectId, line, status) {
  let entry = buildLogStore.get(projectId);
  if (!entry) {
    entry = { logs: '', status: 'building', listeners: new Set() };
    buildLogStore.set(projectId, entry);
  }
  entry.logs += line;
  // ★ 上限 256KB：多人多项目长期运行防内存泄漏（事件流只对启动窗口有意义）
  if (entry.logs.length > 262144) entry.logs = entry.logs.slice(-262144);
  if (status) entry.status = status;
  // 通知所有 SSE 监听器
  for (const listener of entry.listeners) {
    try { listener(line, entry.status); } catch {}
  }
}

/**
 * 向构建日志推送日志行（P1：走事件总线——本地 fanout 立即 append+kick，
 * 其他副本镜像 append，各自 kick 自己的 preview-log watcher）
 */
export function pushBuildLog(projectId, line, status) {
  publish({ t: 'buildlog', projectId, line, status });
}

/**
 * 注册 SSE 监听器，返回取消注册函数
 */
export function subscribeBuildLog(projectId, onLog) {
  let entry = buildLogStore.get(projectId);
  if (!entry) {
    entry = { logs: '', status: 'idle', listeners: new Set() };
    buildLogStore.set(projectId, entry);
  }
  entry.listeners.add(onLog);
  // 立即发送已有日志
  if (entry.logs) {
    onLog(entry.logs, entry.status);
  }
  return () => entry.listeners.delete(onLog);
}

/**
 * 技术栈 -> Dockerfile 模板映射
 */
export function waitForService(url, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 ${url}`, (err, stdout) => {
        const code = stdout?.trim();
        if (code && code !== '000' && code !== '502') {
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 3000);
        }
      });
    };
    check();
  });
}

/**
 * K8s 模式：AI 分析项目生成预览配置 JSON（替代 Dockerfile）
 * 输出 .preview-config.json 到项目目录，start.sh 启动时读取执行
 */
export async function analyzePreviewConfig(projectId, onChunk) {
  const _onChunk = onChunk || (() => {});
  _onChunk('🔍 K8s 模式：AI 分析项目技术栈...\n');

  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  if (!rows[0]?.source_path) throw new Error('项目路径未找到');

  const projectDir = rows[0].source_path;

  // 收集项目信息（复用现有检测逻辑）
  const { collectProjectInfo } = await import('./generate-start-script.js');
  const info = collectProjectInfo(projectDir);

  const detectionText = Object.entries(info.detection)
    .map(([k, v]) => `- ${k}：${v}`)
    .join('\n');

  const filesText = Object.entries(info.files)
    .map(([k, v]) => `### ${k}\n\`\`\`\n${v}\n\`\`\``)
    .join('\n\n');

  const systemPrompt = `你是 Madazi 平台的预览配置生成器。为项目生成 .preview-config.json，告诉启动脚本如何安装依赖和启动服务。

## 运行环境（preview-runtime 容器已预装）
- Node.js 18 + npm + yarn + pnpm
- JDK 17 + Maven
- Go 1.21
- Python 3 + pip
- PostgreSQL 16 + MariaDB + Redis（已运行，端口默认）
- 工作目录: /data/projects/{项目目录名}
- 前端端口: 5173（Vite dev server）

## 输出格式（严格 JSON，不要 markdown 包裹）
{
  "tech_stack": "node-react" | "node-vue" | "node-fullstack" | "java-spring" | "go" | "python" | "static" | "unknown",
  "install_cmd": "安装依赖的命令，如 npm install 或 cd frontend && npm install && cd ../backend && npm install",
  "start_cmd": "启动前端的命令，如 npm run dev -- --host 0.0.0.0 --port 5173",
  "backend_cmd": "启动后端的命令（可选），如 cd backend && npm start 或 cd backend && mvn spring-boot:run",
  "workdir": "/data/projects/{项目目录名}",
  "port": 5173,
  "env": { "NODE_ENV": "development" }
}

## 规则
1. install_cmd 和 start_cmd 在 workdir 下执行
2. 前端必须监听 0.0.0.0:5173（代理转发依赖此端口）
3. 后端如果有，用 backend_cmd 后台启动（& 或 nohup）
4. 纯静态项目（无 package.json）用 "static"，start_cmd 可为 "npx serve -s -l 5173"
5. 如果无法判断，tech_stack 填 "unknown"，install_cmd 和 start_cmd 留空字符串

直接输出 JSON，不要任何解释。`;

  const userPrompt = `请为以下项目生成预览配置 JSON。

## 技术栈检测结果
${detectionText || '(未检测到已知技术栈)'}

## 项目文件树
\`\`\`
${info.tree.join('\n')}
\`\`\`

## 关键配置文件内容
${filesText || '(无配置文件)'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const response = await chatStream(messages, _onChunk, {
    temperature: 0.1,
    max_tokens: 2000,
  });

  // 提取 JSON
  let config;
  try {
    // 尝试直接解析
    config = JSON.parse(response.trim());
  } catch {
    // 尝试从 markdown 代码块提取
    const match = response.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (match) {
      config = JSON.parse(match[1].trim());
    } else {
      throw new Error('AI 未生成有效的 JSON 配置');
    }
  }

  // 验证必需字段
  if (!config.tech_stack) config.tech_stack = 'unknown';
  if (!config.install_cmd) config.install_cmd = '';
  if (!config.start_cmd) config.start_cmd = '';
  if (!config.workdir) config.workdir = `/data/projects/${path.basename(projectDir)}`;
  if (!config.port) config.port = 5173;
  if (!config.env) config.env = {};

  // 写入项目目录
  const configPath = path.join(projectDir, '.preview-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  _onChunk(`✅ 预览配置已生成: tech_stack=${config.tech_stack}\n`);
  return { success: true, configPath, config };
}
