// 平台运行时契约：AI agent（修复/改码任务）必读的最小平台事实集。
// 红线：只写「怎么用」，不写内部拓扑/密钥/认证细节（会随 prompt 发给第三方 LLM）。
// 事实源：preview-templates/entrypoint.sh + services/docker-build.js（analyzePreviewConfig）+
//         services/preview-k8s.js（probeServicePorts）。改运行时行为时同步改这里。
import fs from 'fs';
import path from 'path';

export const RUNTIME_CONTRACT = `## Madazi 预览运行时契约
- 预览跑在独立容器：Node 18 + npm/yarn/pnpm、JDK 17 + Maven、Go 1.21、Python 3 + pip 已预装；npm 已配 npmmirror 镜像源
- 容器内已运行：PostgreSQL（localhost:5432，trust 认证，用户 postgres，库 appdb，含 pgcrypto）、MariaDB（localhost:3306，root 无密码，库 appdb）、Redis（localhost:6379）
- 前端服务优先监听 0.0.0.0:5173（约定端口）；若项目配置占用了其他端口，平台 watcher 会自动探测实际 HTTP 监听端口并回写 .preview-port，探活/代理以它为准——但仍建议遵守 5173 约定，探测只是兜底
- 就绪判定：平台对探测端口（缺省 5173/8080/3001）依次 GET /，任一返回 <500 即视为就绪——应用首页不能 5xx
- 安装/启动唯一事实源是项目根 .preview-config.json（install_cmd / start_cmd / backend_cmd / workdir，workdir 留空=项目根）；改依赖或启动方式后必须同步更新它
- 预览经子域名反代（https://pv-xxx.<YOUR-DOMAIN>.com）访问：前端资源引用与路由一律用相对路径，不要写死域名或 localhost
- 持久化边界：只有项目源码目录持久化；容器内其余路径（/tmp、全局安装等）重启即丢——依赖必须声明在项目清单文件里（package.json/requirements.txt/pom.xml 等）`;

const CONTRACT_MARKER = 'Madazi 预览运行时契约';

// 生成项目根 AGENTS.md 内容（dsh agent 每轮任务自动读取，零边际成本注入契约）
export function buildAgentsMd({ projectName, techStack, sourceDesc }) {
  return `# AGENTS.md

> 本项目由 Madazi 平台托管（${sourceDesc || '导入项目'}）。AI agent 在本项目内工作前必读本文件。

## 项目
- 名称：${projectName || '未命名'}
- 技术栈：${techStack || 'unknown'}（平台自动检测）

${RUNTIME_CONTRACT}

## 工作守则
- 只做任务要求的最小改动，不要重构无关代码
- 平台会自动把改动提交到 git，不需要你手动 commit
- .preview-config.json 不存在时，先按上述契约根据项目实际技术栈创建它；已存在时只在安装/启动方式真的变化时才修改
`;
}

// 写入项目根 AGENTS.md：已含契约段 → 跳过；已有 AGENTS.md → 追加契约段；没有 → 新建
export function writeProjectAgentsMd(projectDir, opts) {
  const file = path.join(projectDir, 'AGENTS.md');
  try {
    if (fs.existsSync(file)) {
      const cur = fs.readFileSync(file, 'utf8');
      if (cur.includes(CONTRACT_MARKER)) return { written: false, reason: 'already' };
      fs.writeFileSync(file, cur.trimEnd() + '\n\n---\n\n' + RUNTIME_CONTRACT + '\n');
      return { written: true, reason: 'appended' };
    }
    fs.writeFileSync(file, buildAgentsMd(opts));
    return { written: true, reason: 'created' };
  } catch (e) {
    console.warn(`[runtime-contract] 写 AGENTS.md 失败（${projectDir}）:`, e.message);
    return { written: false, reason: e.message };
  }
}
