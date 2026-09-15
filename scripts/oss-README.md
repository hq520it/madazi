# madazi · 码搭子

> 🌐 [English](README.en.md) | 简体中文

> 可私有化部署的 AI 应用搭建平台 —— 多人、多项目、多会话的一站式 AI 协作基础设施。
> 两种部署形态：**单机版**（免 Docker / 免 Kubernetes，一台机器 Node.js + PostgreSQL 即跑）与 **K8s 云版**（多节点 / 公网域名，见「私有化部署（K8s 云版）」）。

madazi 以 DeepSeek Harness 为智能体内核，在共享单进程实例上实现了租户级的安全隔离，
把「项目创建 → 需求对话 → 编码开发 → 测试 → 预览 → 部署」的 IT 团队工作流装进一个自托管平台。

## 特性

- **多人多项目协同**：多账号、项目成员与角色管理、项目内共享会话；会话可见性与文件访问按**当前活跃操作者**动态授权，杜绝共享会话越权
- **AI 智能体工作台**：基于 DeepSeek Harness 的会话式开发，集成终端、文件系统沙箱、技能（Skills）与子代理
- **模板市场**：项目模板的发布 → 审核 → 一键安装闭环；发布时自动扫描疑似密钥内容
- **技能共享**：技能目录的安装、分享与跨项目复用
- **项目预览**：内置预览运行时，随时启动/停止并在线预览生成的应用（可选，需本机 Docker）
- **安全网关**：登录门 + 项目权限裁剪（含 API/WS 三层访问控制）+ 沙箱跨项目权限钳制
- **私有化部署**：单机本地运行，代码与数据完全自持
- **内置浏览器与 AI 浏览器控制**：让智能体像人一样操作页面

## 快速开始（单机版）

支持平台：**macOS / Linux**（同时兼容 x86_64 与 arm64）。

### 环境要求

- Node.js ≥ 22
- PostgreSQL ≥ 14（本机已安装并启动；或用 Docker 起一个，见下方"数据库准备"）
- pnpm（`npm i -g pnpm`）
- （可选）Docker —— 仅"项目预览"需要

### 1) 一键安装（fork 内核产物 + 平台插件 + 工作台 profiles）

```bash
bash scripts/standalone/bootstrap.sh
```

脚本自动完成：构建 dsh-src fork 产物（缺失时）→ 安装 dsh 承载体 →
安装 madazi-server 平台依赖 → 覆盖 fork 内核产物（连接/技能/工作区三包）→
铺入 madazi 插件（登录门 + 平台面板）→ 组装 workbench 工作台 profiles。

> 国内网络默认走 npmmirror 镜像加速；海外用户可设环境变量改用官方源再跑：
> `NPM_REGISTRY=https://registry.npmjs.org bash scripts/standalone/bootstrap.sh`

### 2) 数据库准备（仅首次）

平台默认连接 `postgres://madazi:madazi_dev_2026@localhost:5432/madazi`。本机 PG 建库：

```bash
psql postgres -c "CREATE ROLE madazi LOGIN PASSWORD 'madazi_dev_2026'; CREATE DATABASE madazi OWNER madazi;"
```

或（无本地 PG，用 Docker 一条命令起库，连接串与默认值一致）：

```bash
docker run -d --name madazi-pg -p 5432:5432 -e POSTGRES_PASSWORD=madazi_dev_2026 -e POSTGRES_USER=madazi -e POSTGRES_DB=madazi postgres:16
```

### 3) 启动平台（双进程：dsh web + madazi server）

```bash
bash scripts/standalone/start.sh
```

- 浏览器入口：http://localhost:3456/dsh-web/ （server 同源聚合：页面反代 dsh web，/api/* 平台 API 直供）
- 默认账号：`admin / admin123`（首次启动自动创建，**请立即修改**）
- 新用户注册需邀请码（在「管理 → 邀请码」中生成）
- 停止：`Ctrl+C`（同时收下两个进程）

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgres://madazi:madazi_dev_2026@localhost:5432/madazi` | 平台数据库 |
| `PORT` | `3456` | server 监听端口 |
| `DSH_WEB_PORT` | `3080` | dsh web 端口（固定 127.0.0.1） |
| `DSH_HOME` | `~/.madazi/dsh-home` | dsh 数据目录（会话/配置/数据库文件，备份它即可迁移） |
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | npm/pnpm 依赖源（海外可设 `https://registry.npmjs.org`） |
| `NO_OPEN=1` | 关 | 不自动打开浏览器 |

### 故障排查

- **PostgreSQL 未运行 / Connection refused**：`brew services start postgresql@16`（macOS）或 `sudo systemctl start postgresql`（Linux），或改用上面的 Docker 起库。
- **依赖安装很慢 / 超时**：切源重跑 —— `NPM_REGISTRY=https://registry.npmjs.org bash scripts/standalone/bootstrap.sh`。
- **bootstrap 中途失败**：修复后直接重跑即可，脚本各步骤幂等；dsh 承载体/依赖已装的部分会复用。
- **启动后浏览器打不开**：`NO_OPEN=1 bash scripts/standalone/start.sh` 后手动访问 http://localhost:3456/dsh-web/ 。
- **怎么看日志**：`/tmp/madazi-dsh.log`（dsh web）与 `/tmp/madazi-server.log`（平台 server）。
- **忘记管理员密码**：删库重建（数据清空）或咨询 `src/middleware/initAdmin.js` 初始化逻辑。

## 架构一览（单机版）

```
浏览器 ──▶ madazi-server (0.0.0.0:3456)
              ├── /dsh-web/ 页面反代 ──▶ dsh web (127.0.0.1:3080, fork 内核 + workbench 插件)
              ├── /api/* 平台 API 家族 ──▶ 平台路由（认证/项目/模板/技能/预览代理）
              ├── 其余 /api + 数据面（RPC/WS/事件流）──▶ dsh web
              └── LLM 网关（模型代理 + 用量记账）──▶ 上游模型服务
数据层：PostgreSQL（业务）/ DSH_HOME（会话 + 配置）/ generated/（项目源码）
```

核心组件：

| 组件 | 说明 |
|---|---|
| `madazi-server/` | 平台 API + dsh 反向代理网关 + 登录门 + 项目权限/终端/协作 |
| `wb-src/` | DeepSeek Harness Web UI 定制 fork（三栏工作台、沙箱钳制、浏览器控制） |
| `dsh-src/` | DeepSeek Harness 内核源码 fork（本地构建替代 npm 包，含 madazi 内核定制） |
| `madazi-server/docker/acp/plugins/` | 平台插件（登录门 / 项目面板：src/*.js → build.cjs → client.js） |
| `templates/` | 项目模板（vue/react/uniapp × springboot/node） |
| `scripts/standalone/` | 单机版安装与启动脚本 |
| `k8s/`、`deploy/` | K8s 云版部署清单（裸清单 + Helm chart） |

## 私有化部署（K8s 云版）

> 单机版是快速上手形态；需要多节点 / 公网域名 / 高可用时走 **K8s 云版**（单节点 K3s 或云托管 Kubernetes 均可）。

需要准备：Kubernetes 集群（K3s 一条命令可装）+ Docker（构建镜像）+ 域名（可选）。核心链路：**构建镜像 → 导入集群（`k3s ctr -n k8s.io images import`）→ `kubectl apply -f k8s/` → 入口走 traefik**。

```bash
# 一键（本机 K3s / 远程设 REMOTE=user@host）
./deploy-k3s.sh all        # 构建+导入+apply+等待+verify

# dsh-web 工作台镜像单独构建（成体系流程，含 PVC 版本管理）
bash scripts/build-dsh-web.sh

# 探活 & 状态
./deploy-k3s.sh verify     # 网络层入口 + /api/health + 登录页（VERIFY_URL 可配）
./deploy-k3s.sh status
```

- 入口：`https://<your-domain>/dsh-web/`，默认账号 `admin / admin123`
- 完整部署前置、配置项（JWT/PG 口令/预览域名）、云托管 K8s 镜像仓库流程、故障排查见 **[k8s/README.md](k8s/README.md)**；部署链路与 WebSocket 全景见 **docs/ARCHITECTURE.md**

## 安全

madazi 在共享单进程的智能体宿主上实现了租户级隔离：

- 会话可见性与文件访问按「当前活跃操作者」动态授权（而非会话归属者），并拒绝任何不确定状态（fail-closed）
- 沙箱高危授权模式在策略解析层被语义重定义为「当前操作者授权范围」，多执行出口一致钳制
- 权限撤销经推送通道秒级生效
- 部署后请务必：修改默认管理员密码、更换 `JWT_SECRET` 等生产凭据

## License & Third-party components

本仓库采用 [Apache-2.0](LICENSE) 开源。

组成部分与派生关系：

| 组件 | 来源 | 许可证 |
|---|---|---|
| 平台本体（madazi-server / 插件 / 启动器 / 部署） | 本项目 | Apache-2.0 |
| [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 官方内核 | 官方开源工程，`dsh-src/` fork 自其 `dsh-v0.1.5-rc.1` 标签并含 madazi 内核定制 | MIT |
| [deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin)（`wb-src/` fork 来源） | 第三方开源工程 | MIT |

上游项目的版权与许可声明保留在其各自目录内。

## 致谢

感谢 **DeepSeek Harness（dsh）** 与 DeepSeek 团队——本平台赖以运行的智能体工作台内核源自其开源项目。

感谢 **[deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin)** 项目——madazi 的三栏工作台 UI fork 自该项目。

向所有开源贡献者致敬。