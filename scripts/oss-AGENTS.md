# madazi 仓库 AGENTS.md

本文件是 madazi（单机版）开源仓库的 agent 入口约定。开工前必读。

## 📐 架构拓扑（超简）

```
浏览器 ──▶ madazi-server (Express, 0.0.0.0:3456)
              ├── /dsh-web/ 页面反代 ──▶ dsh web (127.0.0.1:3080, fork 内核 + workbench 插件)
              ├── /api/* 平台 API 家族 ──▶ 平台路由（认证/项目/模板/技能/预览）
              ├── 其余 /api + 数据面（RPC/WS 事件流）──▶ dsh web
数据层：PostgreSQL（业务）/ DSH_HOME（会话配置）/ generated/（项目源码）
```

启动：`bash scripts/standalone/bootstrap.sh` → `bash scripts/standalone/start.sh`。
入口 http://localhost:3456/dsh-web/ ，默认管理员 `admin/admin123`（立即修改）。

## 🚨 铁律

- **dsh 内核定制走 dsh-src fork 源码**（packages/client/{connection,ui-skill,ui-workspace}），
  改完 `cd dsh-src && pnpm build` 后由 `scripts/standalone/bootstrap.sh` 覆盖全局树 lib；
  不要直接编辑 dsh 全局 node_modules 里的产物
- **wb-src（workbench 插件）改源码后跑 `npm run build` 再 npm pack**，产物经 profiles-web 的
  tgz 进 DSH_HOME；`lib/client.js` 是 build 产物，改源码后重新构建，不直接编辑
- **madazi 插件改 src/*.js 后跑 `node lib/build.cjs` 重建 lib/client.js**，再跑 bootstrap
  的插件段（或同步全局树）；SearchReplace 后必 `node --check` 防半截脏写
- **未捕获异步异常崩进程**：Express async handler 里抛错会导致进程退出——新加 import
  必须冒烟触发一次真实路径
- madazi 集成 dsh = **零注入**（官方扩展点），弃 DOM hack

## 🛠 常用命令

```bash
# 单机版数据目录：DSH_HOME=~/.madazi/dsh-home（备份它 + PG dump 即可迁移）
# 依赖源切换（海外）：NPM_REGISTRY=https://registry.npmjs.org bash scripts/standalone/bootstrap.sh
# 项目预览：需本机 Docker；无 colima 时直接查本机 docker 环境即可
```

## 📁 模块速览

- `madazi-server/` — Node/Express 平台 API + dsh 反代网关（dsh-web-proxy.js 是分流核心）
- `dsh-src/` — DeepSeek Harness 内核源码 fork（本地构建替代 npm 包，含 madazi 内核定制）
- `wb-src/` — DeepSeek Harness Web UI 定制 fork（三栏工作台、沙箱钳制、浏览器控制）
- `madazi-server/docker/acp/plugins/` — 平台插件（login 登录门 + madazi 项目面板）
- `scripts/standalone/` — 单机版安装与启动脚本
- `templates/` — 项目模板（vue/react/uniapp × springboot/node）