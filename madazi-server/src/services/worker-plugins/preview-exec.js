/**
 * preview_exec 插件
 * 在预览容器(Pod)内执行 shell 命令——AI 检测/安装/搭建环境，让项目跑起来
 *
 * 典型用法：
 *   1. 检测环境：python3 --version / node -v / java -version / go version
 *   2. 安装环境：pip install xxx / npm install xxx / apk add xxx
 *   3. 排查问题：ps aux | grep -v grep / df -h / ls /data/<项目目录>
 *   4. 服务自测：curl -s http://localhost:5173 / curl -s http://localhost:3001/api/health
 *
 * 注意：需要预览已启动（Pod 存在）。安装的系统级包在 Pod 重建后丢失，
 *       项目级依赖请装到 /data/<项目目录> 下（PVC 持久）。
 */
export default {
  name: 'preview_exec',
  description: '★ 在项目的预览容器内执行 shell 命令。当用户的项目跑不起来、报错、缺依赖/环境时使用：检测环境（python3 --version、node -v、java -version）、安装依赖或运行时（pip install、npm install、apk add）、查看项目文件与进程（ls、ps、df）、自测服务（curl localhost）。返回命令输出。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要在预览容器内执行的 shell 命令（单行，可含管道/&&）' },
      project_id: { type: 'string', description: '项目 ID（省略时用当前对话关联项目）' },
    },
    required: ['command'],
  },
  async execute(args, ctx) {
    const projectId = args.project_id || ctx?.projectId;
    if (!projectId) {
      return JSON.stringify({ error: '缺少项目 ID（未指定且当前对话无项目上下文）' });
    }
    try {
      const { getPreviewPodStatus } = await import('../preview-k8s.js');
      const st = await getPreviewPodStatus(projectId);
      if (!st.exists || !st.ready) {
        return JSON.stringify({ error: '预览未运行（Pod 不存在或未就绪），请先启动预览再执行' });
      }
      const { execPreviewPodCommand } = await import('../terminal-k8s.js');
      const output = await execPreviewPodCommand(projectId, args.command, { timeoutMs: 120000 });
      const text = String(output || '').slice(0, 4000);
      return JSON.stringify({ ok: true, output: text, truncated: String(output || '').length > 4000 });
    } catch (e) {
      return JSON.stringify({ error: `执行失败: ${e.message}` });
    }
  },
};
