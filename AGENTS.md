# madazi 仓库 AGENTS.md

本文件是所有在 `~/code/madazi` 工作的 agent 的**入口约定**。开工前必读。

## 📐 架构拓扑（必读）

**完整链路说明：`docs/ARCHITECTURE.md`** —— 节点清单、每段通讯（协议/端口/认证）、WebSocket 全景、部署链路、故障排查速查表、变更联动都在那里。**改任何一跳前先读第 6 节「变更联动」**。

一句话拓扑（P3 后）：外部流量打 `traefik:80`（frp 7456→NodePort 30456），IngressRoute 分流——平台 API 家族与 pv-* 预览子域 → `madazi-server:3456`（ClusterIP）；其余 dsh 数据面（RPC/events.mux WS/静态）→ `madazi-dsh-web:3080`（forwardAuth 登录门 + 特权 RPC loopback 伪装）。**server 滚动发版不断 dsh 事件流**。

## 🚨 铁律（违者踩坑）

- **quda nginx 改配置必须 `nginx -t && nginx -s reload`**（曾改完未 reload → 全站 WS 502）
- **镜像导入必须 `sudo k3s ctr -n k8s.io images import -`**（colima VM 双 containerd，系统 ctr 导了 k3s 看不见 → ImagePullBackOff）
- **换镜像用新 tag**（`latest` + IfNotPresent 会复用旧镜像）；configmap 改动必须 rollout restart
- **路由反转（2026-08-24）+ 三表同步（P3 起）**：新增 dsh RPC **零配置自动通**（`/api/*` 非平台家族全 fall-through 到 dsh）；新增**平台 API 路由家族** → **三表镜像同步**：`dsh-web-proxy.js` 的 `PLATFORM_API` 正则 + web-proxy configmap 白名单 + traefik-routes.yaml（及 helm `templates/traefik.yaml`）的 IngressRoute 正则（漏一处 = 404、401 或 server↔pod 环路）
- **WS 认证**：project-ws.js 只认 query/cookie token；Authorization 头 → 502/52
- **前端/代码用最新 wb-src**，不回滚；实时数据一律 WS 推送（平台禁轮询）
- madazi 集成 dsh = **零注入**（官方扩展点），弃 DOM hack

## ✨ 代码优雅性（违者烂尾）

- **单文件不超 ~500 行**：超了就拆模块。dsh-plugin-madazi/lib/client.js 曾 3930 行 -> 拆 18 个 src/*.js + build.cjs 拼接，改一处不用滚半屏
- **SearchReplace 改完必 `node --check`**（或对应语言的语法检查）：失败的替换可能只写了半截（部分脏写），语法检查是最后一道防线
- **默认值三处对齐**：settings.js DEFAULTS + db/init.js seed + 调用方 fallback。ON CONFLICT DO NOTHING 只对新装生效，存量行必须 live UPDATE
- **未捕获异步异常崩进程**：Express async handler 里的 ReferenceError 不被兜住 -> Node 退出 -> 全站 500。新加 import 后必须冒烟触发一次真实路径
- **构建产物不入 src/**：client.js 是 build.cjs 从 src/*.js 拼接的产物，改源码后跑 `node lib/build.cjs` 重建，不直接编辑产物

## 🛠 常用命令

```bash
export DOCKER_HOST=unix://$HOME/.colima/madazi/docker.sock
K="colima ssh -p madazi -- sudo k3s kubectl -n madazi"
# 部署：build → docker save | k3s ctr import → apply/rollout（详见 docs/ARCHITECTURE.md §4）
```

## 📁 模块速览

- `madazi-server/` — Node/Express 平台 API + dsh 反代网关（dsh-web-proxy.js 是分流核心）
- `wb-src/` — 官方 DSH Web UI 源码（tsdown 构建，scripts/build-dsh-web.sh）
- `deploy/helm/madazi/` — **标准交付物 Helm chart**（云 k8s/裸机 k3s 一把装；nginx 白名单与 PLATFORM_API 正则的同步义务同 k8s/ 裸清单）
- `k8s/` — 裸 yaml 清单（本机集群现行；新环境部署一律走 helm chart）
- `templates/` — 项目模板（vue/react/uniapp × springboot/node），各模板自带 AGENTS.md
