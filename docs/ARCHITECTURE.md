# madazi 平台架构拓扑（2026-09-06 重整理：dsh 0.1.2-rc.1 + 沙箱跨项目权限钳制 + SSE 权限映射推送 + @引用权限过滤）

> 本文档是平台**通讯链路**的唯一权威说明。改任何一跳前先读「§11 变更联动」。
> 其他 agent 入口：根目录 AGENTS.md 有引用。
> 最近大改：P3 Traefik 入口接管（2026-08-24）→ dsh 0.1.2 升级（2026-09-01/03）→
> 沙箱跨项目按权限读写 + 权限映射 SSE 推送 + @引用权限过滤（2026-09-05/06，见 §4.4/§13）。

## 0. 总览

```
浏览器(用户/手机) ──wss/https(HTTP/2)──▶ quda nginx (<SERVER-IP>, 443, TLS 终结)
                                          │  主站块 location 分流（madazi.<YOUR-DOMAIN>.conf）
                                          ├─ /api/ /dsh-web/ /plugins/ /git/ /assets/ /socket.io 等 → 127.0.0.1:7456 (frps)
                                          ├─ /llm/ → 127.0.0.1:7459 (llm-gateway frps)
                                          └─ pv-* 子域 → 127.0.0.1:7456（server 动态预览代理）
                                          ▼
                                  frps (quda:7456/7459)
                                          │  frp 隧道（token: <FRP-TOKEN>）
                                          ▼
                                  frpc (colima VM, /etc/frpc.toml)
                                          │  7456→NodePort 30456；7459→NodePort 30459
                                          ▼
                      k3s (colima VM, namespace: madazi)
                      ┌───────────────────────────────────────────────────────────┐
                      │ NodePort 30456 ──▶ traefik:80（入口网关，仅 HTTP/1.1）       │
                      │   IngressRoute madazi-entry 分流（k8s/traefik-routes.yaml） │
                      │   ├─ pv-* 子域           → madazi-server:3456              │
                      │   ├─ /api/ 平台家族       → madazi-server:3456              │
                      │   ├─ /api/skills/list 精确 → dsh-web:3080（dsh 技能RPC）    │
                      │   ├─ 特权 RPC(/api/….)    → dsh-web:3080（loopback 伪装）   │
                      │   ├─ /api/events.{mux,host}→ dsh-web:3080（事件流 WS）      │
                      │   ├─ /api 其余 dsh RPC    → dsh-web:3080（forwardAuth）     │
                      │   ├─ /dsh-web /plugins 等 → dsh-web:3080（公开静态）        │
                      │   └─ /socket.io /git 等   → dsh-web:3080（forwardAuth）     │
                      │  madazi-server:3456：平台 API + forwardAuth 探针 + pv 代理   │
                      │  dsh-web pod：web-proxy nginx(3080) → dsh 本体 127.0.0.1:3081│
                      │       ▲ 平台家族白名单回流 server（防环路，见 §2.6）          │
                      │  llm-gateway:3459（NodePort 30459，frp 7459，dsh 模型腿直连）│
                      │  Postgres:5432 / Redis:6379（事件总线）/ PVC projects        │
                      └───────────────────────────────────────────────────────────┘
```

**一句话**：外部流量打 quda nginx（TLS/HTTP2 终结）→ frp 隧道 → traefik:80 分流——平台 API 家族与 pv-\* 预览子域 → `madazi-server:3456`；其余 dsh 数据面（RPC/events WS/静态）→ `madazi-dsh-web:3080`（forwardAuth 登录门 + 特权 RPC loopback 伪装）。**server 滚动发版不断 dsh 事件流**（chaos 实测 2026-08-24）。

***

## 1. 节点清单（2026-09-03 运行时核实）

| 节点                 | 位置                 | 端口/服务                         | 镜像 tag                    | 角色                                                                                      |
| ------------------ | ------------------ | ----------------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| quda nginx         | 云服务器 <SERVER-IP> | 443/80                        | nginx 1.24                | 域名入口，TLS/HTTP2 终结，主站分流，SSE 透传加固                                                         |
| frps               | quda               | 7000(控制)/7456(API)/7459(LLM)  | —                         | frp 服务端                                                                                 |
| frpc               | colima VM          | 7456→30456, 7459→30459        | —                         | frp 客户端（/etc/frpc.toml）                                                                 |
| k3s                | colima VM          | NodePort 30456/30459          | —                         | 集群（namespace madazi）                                                                    |
| traefik            | k3s Deployment     | 80 / NodePort 30456           | traefik:v3.5              | **入口网关**：IngressRoute 分流 + forwardAuth 登录门 + 特权 RPC 伪装（readTimeout/idleTimeout=0 保 WS）  |
| madazi-server      | k3s Deployment     | 3456 (ClusterIP)              | madazi-server:ref-filter  | 平台 API + forwardAuth 探针 + pv-\* 预览动态代理 + 会话数据层权限拦截 + **权限映射 SSE 推送**（access-map/events） |
| madazi-dsh-web     | k3s Deployment     | 3080(sidecar nginx)/3081(dsh) | madazi-dsh-web:latest     | 官方 DSH Web UI 0.1.2-rc.1 + 插件宿主（madazi/login/workbench）+ **沙箱 clamp（跨项目按权限读写）**         |
| madazi-preview     | k3s StatefulSet    | headless 3000                 | madazi-preview-runtime/\* | 项目预览运行时（runtime/spring/node，动态启停）                                                       |
| madazi-postgres    | k3s Deployment     | 5432 (ClusterIP)              | postgres:16-alpine        | 主数据层（PVC 5Gi）                                                                           |
| madazi-redis       | k3s Deployment     | 6379 (ClusterIP)              | redis:7-alpine            | P1 事件总线（纯内存，跨副本 pub/sub）                                                                |
| madazi-llm-gateway | k3s Deployment     | 3459 / NodePort 30459         | madazi-llm-gateway:g01    | LLM 代理网关（dsh 模型腿直连，frp 7459）                                                            |

**PVC**：`madazi-postgres-pvc`（5Gi，local-path）、`madazi-projects-pvc`（10Gi，local-path）——均带 nodeAffinity 钉住数据节点。

**镜像清单**（colima docker 侧 + k3s containerd 侧）：`madazi-server`、`madazi-dsh-web`、`madazi-preview-runtime/spring/node`、`madazi-llm-gateway`、`madazi-dsh`（dsh-web 基础镜像）、`madazi-worker`。

***

## 2. 通讯链路详解

### 2.1 外部入口（quda nginx）

- 主站配置：`/etc/nginx/conf.d/<YOUR-DOMAIN>.conf`（server\_name <YOUR-DOMAIN> + pv-\* 泛子域块）

- 域名泛解析 + 泛证书（\*.<YOUR-DOMAIN>.com）在 `<YOUR-DOMAIN>-quda.conf` default\_server

- **HTTP/2 端口级生效**：nginx 1.24 中同端口 443 上其它 server 声明了 `listen 443 ssl http2;`，故主站虽只写 `listen 443 ssl;` 也被动运行 HTTP/2（2026-09-03 实测 curl 返回 http2）

- **主站块 location 分流**（全部 `proxy_pass http://localhost:7456`，带 WS Upgrade 头）：

  - `/api/`、`/dsh-web/`、`/git/`、`/workbench-sounds/`、`/ultra-slash/`、`/assets/` → frps:7456

  - `/plugins/` → frps:7456，**2026-09-03 加固**：`proxy_buffering off; proxy_read_timeout 3600s;`（SSE 即时透传，消除「缓冲→上游停滞误判→HTTP/2 RST\_STREAM→ERR\_HTTP2\_PROTOCOL\_ERROR」）

  - `/llm/` → `proxy_pass http://localhost:7459/`（无前缀改写，`proxy_buffering off` + 3600s，`chunked_transfer_encoding on`）

  - `location /` → `proxy_pass http://localhost:7456/dsh-web/;`（apex 重写 + 剥离 Accept-Encoding 让上游 gzip）

- ⚠️ 铁律：**改 quda nginx 必须** **`sudo nginx -t && sudo nginx -s reload`**（曾 8/21 改完未 reload → 全站 WS 502）。改动前先 `cp 配置 配置.bak-时间戳`

### 2.2 frp 隧道（colima VM）

`/etc/frpc.toml`：

```
serverAddr = "<SERVER-IP>", serverPort = 7000, auth.token = "<FRP-TOKEN>"
[[proxies]]  # madazi-api
  type=tcp  localPort=30456  remotePort=7456    ← 平台 API + dsh 数据面主通道
[[proxies]]  # madazi-llm-gateway
  type=tcp  localPort=30459  remotePort=7459    ← dsh 模型腿直连
```

- 加端口改 frpc.toml 后 `systemctl restart frpc`（或等价）

- frps 在 quda 侧：`sudo ss -tlnp` 看 7456/7459

### 2.3 k3s 网络

- 命名空间：`madazi`；kubectl 前缀：`colima ssh -p madazi -- sudo k3s kubectl -n madazi`

- Service：`madazi-server:3456`、`madazi-dsh-web:3080`、`madazi-preview`(headless:3000)、`madazi-postgres:5432`、`madazi-redis:6379`、`madazi-llm-gateway:3459`、`traefik:80`

- NodePort：traefik=30456、llm-gateway=30459

- ⚠️ 双 containerd 坑：colima VM 有两个 containerd（系统 /run/containerd 与 k3s 自己的 /run/k3s/containerd）。**导入镜像必须** **`sudo k3s ctr -n k8s.io images import -`**，用系统 ctr 导了 k3s 看不到 → ImagePullBackOff

- ⚠️ 磁盘红线：colima docker（/var/lib/containerd）与 k3s 共享 /dev/vdb1；docker 构建 junk 超过 85% 触发 kubelet 静默删 k3s 镜像（preview/dsh 无运行容器 → 首当其冲）。`docker container prune -f && docker image prune -f` 保持 <80%

### 2.4 traefik 入口网关（k8s/traefik.yaml + k8s/traefik-routes.yaml）

- 独立 Deployment（k3s 启动带 `--disable traefik`，零冲突）；只监听 :80（HTTP/1.1），**不做 TLS**（TLS 在 quda）

- **关键参数**：`readTimeout=0 / idleTimeout=0`（默认 60s/180s 会杀静默事件流 WS，必须关）

- Middleware：

  - `dsh-auth`：forwardAuth → `http://madazi-server:3456/api/auth/check`（登录门，三通道判 token）

  - `strip-dsh-web`：`/dsh-web/*` → `/*`（官方 UI 根路径）

  - `dsh-privileged`：`Host: 127.0.0.1` + 删 Origin（绕 dsh loopback-only 围栏）

- **IngressRoute madazi-entry 路由表**（优先级从高到低，与 server PLATFORM\_API / pod nginx 白名单**三表镜像同步**，见 §11.2）：

| #   | 路由匹配                                        | 优先级          | middlewares       | 目标                                       | <br />                                 | <br />             | <br />                  | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |
| --- | ------------------------------------------- | ------------ | ----------------- | ---------------------------------------- | :------------------------------------- | :----------------- | :---------------------- | :----- | :------------------------ | :---------------------- | :------ | :----- | :----- | :----- | :---------------------------- |
| 1   | `HostRegexp(pv-[a-z0-9]{8}.<YOUR-DOMAIN>.com)` | 10000        | —                 | madazi-server:3456（预览动态代理）               | <br />                                 | <br />             | <br />                  | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |
| 2   | \`PathRegexp(^/api/(health                  | auth         | keys              | admin                                    | market                                 | projects           | dsh                     | llm    | templates                 | skills                  | license | ws))\` | 1000   | —      | madazi-server:3456（平台 API 家族） |
| 2.5 | `PathRegexp(^/api/skills/list$)`            | 1100         | dsh-auth          | dsh-web:3080（dsh 技能目录 RPC，2026-09-02 新增） | <br />                                 | <br />             | <br />                  | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |
| 3   | \`PathRegexp(^/api/(settings.               | credentials. | agentPreset.      | host.pickDirectory                       | host.openPath                          | llm.               | pluginInventory))\`     | 200    | dsh-auth + dsh-privileged | dsh-web:3080（特权 RPC 伪装） | <br />  | <br /> | <br /> | <br /> | <br />                        |
| 3.5 | \`PathRegexp(^/api/events.(mux              | host))\`     | 150               | dsh-auth                                 | dsh-web:3080（事件流 WS 豁免，server 滚动发版不断流） | <br />             | <br />                  | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |
| 4   | `PathPrefix(/api)`                          | 100          | dsh-auth          | dsh-web:3080（其余 dsh RPC，零配置自动通）          | <br />                                 | <br />             | <br />                  | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |
| 5   | `PathPrefix(/dsh-web)`                      | —            | strip-dsh-web     | dsh-web:3080（公开）                         | <br />                                 | <br />             | <br />                  | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |
| 6   | \`PathPrefix(/plugins                       | /assets      | /favicon)\`       | —                                        | —                                      | dsh-web:3080（公开静态） | <br />                  | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |
| 7   | \`PathPrefix(/socket.io                     | /git         | /workbench-sounds | /ultra-slash)\`                          | —                                      | dsh-auth           | dsh-web:3080（dsh 数据面顶层） | <br /> | <br />                    | <br />                  | <br />  | <br /> | <br /> | <br /> | <br />                        |

### 2.5 madazi-server（平台 API + 会话数据层权限 + pv 代理）—— 核心节点

**平台 API 路由**（src/index.js）：/api/health、/api/auth、/api/keys、/api/admin、/api/admin/market、/api/admin/plugins、/api/market、/api/projects（+member+preview+db）、/api/dsh、/api/llm、/api/templates、/api/skills、/api/license、/api/projects/:id/collab/status

- `licenseGate` 挂 /api：未激活/过期/域名不匹配 → 全站 403（放行 health/license）

**dsh 反代网关**（src/services/dsh-web-proxy.js，HTTP 中间件挂 express.json 之前）：

- `TARGET = madazi-dsh-web:3080`；changeOrigin:false（保留平台域 Host，匹配 dsh --trusted-host）

- **路由反转（2026-08-24）**：平台 API 家族白名单先行（PLATFORM\_API 正则），其余 /api/\* 一律视为 dsh RPC → 登录门 → proxy 到 dsh-web（**新增 dsh RPC 零配置自动通**）

- `PLATFORM_API` 正则（2026-09-02 更新，skills 负向前瞻）：

  ```
  /^\/api\/(health$|auth(?:\/|$)|keys(?:\/|$)|admin(?:\/|$)|market(?:\/|$)|projects(?:\/|$)|dsh(?:\/|$)|llm(?:\/|$)|templates(?:\/|$)|license(?:\/|$)|ws(?:\/|$)|skills(?!\/list(?:\/|$))(?:\/|$))/
  ```

  - `skills(?!\/list(?:\/|$))`：排除 /api/skills/list（dsh 技能目录 RPC），平台 skills API（GET /mine、/install 等）仍走 server

- 静态放行（未登录）：/dsh-web、/plugins、/assets、/favicon；登录门反代：/socket.io、/git、/workbench-sounds、/ultra-slash；未知路径 → 平台 404

- WS upgrade：/ws 维持无鉴权（官方本地工具语义）；/socket.io、/api/events.\* 登录门后反代

- **特权 RPC 伪装**（PRIVILEGED\_RPC）：/api/(settings.|credentials.|agentPreset.|host.pickDirectory|host.openPath|llm.|pluginInventory) → Host: 127.0.0.1 + 删 Origin

- ⚠️ 三表镜像同步义务：server PLATFORM\_API + pod nginx 白名单 + traefik IngressRoute（漏一处 = 404/401 或 server↔pod 环路）

**会话数据层权限拦截**（2026-08-27 起 RPC HTTP 面）：dsh RPC 经 server 时按当前用户会话/项目成员做过滤（session-access.js），WS 事件流（events.mux/host）保持直连 pod 不切。

### 2.6 dsh-web pod（Deployment madazi-dsh-web，replicas:1）

```
pod: madazi-dsh-web
├─ initContainer profile-init：PVC /app/generated 模板合并（.dsh/profiles/web）+ 插件 symlink
│    （dsh-plugin-madazi / dsh-plugin-login → 镜像全局树；模板版本门控 .madazi-template-version）
├─ container dsh-web：--port 3081 --trusted-host <YOUR-DOMAIN>（dsh 0.1.2-rc.1）
│    DSH_HOME=/app/generated/.dsh；DSH_SNAPSHOT_SESSIONS_ROOT=/app/generated/.dsh-sessions；
│    SSH_CONNECTION 伪装（browse 必需）；PVC projects 挂载；MADAZI_API_BASE=http://madazi-server:3456
│    MADAZI_SERVER_URL=http://madazi-server:3456 / MADAZI_INTERNAL_TOKEN（沙箱 clamp 权限映射，2026-09-05）
└─ container web-proxy：nginx:alpine 听 3080（configmap dsh-web-nginx）→ 分流：
     ├─ location ~ ^/assets/.+\.(js|css|svg|woff2?|png|jpe?g|ico)$ → 长缓存 + 本地
     ├─ location ~ ^/plugins/.+\.js$ → 长缓存（rev 化插件 bundle）
     ├─ location /plugins/events → 透传 dsh 本体（SSE）
     ├─ location = /api/skills/list → 转发 127.0.0.1:3081（dsh 技能 RPC，2026-09-02）
     ├─ location ~ ^/api/(auth/|keys/|admin/|market/|projects/|dsh/|llm/|templates/|skills/|license/|ws/) → madazi-server:3456（平台白名单回流）
     ├─ location /api/（其余 dsh RPC + events）→ 127.0.0.1:3081
     ├─ location = /readiness → 200（web-proxy 就绪探针，2026-09-01 新增，绕 BrowserAuth 401）
     └─ location / → 127.0.0.1:3081（静态+其余，含 WS 头）
```

- 官方 dsh 只绑 127.0.0.1：dsh-web 容器 3081，sidecar nginx 对外 3080

- ⚠️ **web-proxy 白名单与 server 转发前缀是两个方向的分流**：外部→server→(前缀)→dsh-web 3080→(白名单正则)→回流 server / →3081

- **replicas:1 真实根因**（2026-08-24 调研修正）：dsh web 是单进程 Cordis 容器——HTTP 服务、全部 agent 会话循环、全部 events.mux 连载同一 node 进程；进行中的 agent turn 只存在于进程内存，Redis 总线救不了必须打到 owning 副本的 RPC。**正确姿势 = 单副本 HA**（chaos 实测杀 pod → 14s 重生、16 会话全保留（PVC）、页面 200）+ 垂直扩展（2Gi）+ P2 共享存储解锁跨节点漂移

### 2.7 dsh 0.1.2-rc.1 升级定制（2026-09-01 alpha.5 → 09-03 rc.1，Dockerfile.dsh-web）

| 定制                  | 实现                                                                                                     | 目的                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| trusted-host bypass | patch dsh-client-connection/lib/index.js：browserAuth.isAuthenticated → undefined、authorizeIndex → true | 绕过 alpha.5 强制 BrowserAuth（公网拿不到随机 token 会全站 401），信任边缘 forwardAuth 登录门 |
| loopback 围栏放宽       | patch dsh-client-connection/lib/client.js isLoopback + index.html 注入 __DSH\_TRUSTED\_LOOPBACK__        | 设置→模型 tab 可用（公网域名访问时 settings mirror 不再 unavailable）                  |
| 技能目录唤起即刷新           | patch dsh-client-ui-skill/lib/client.js：candidates 前 invalidate(session.sessionId)                     | 新技能写入后 / 菜单立即带出最新清单                                                   |
| 连接超时 3s→12s         | sed generationReadyTimeoutMs: 3e3→12e3                                                                 | 公网冷启动首波 5s+ 不再进入失败重试循环                                                |
| membership gate（fork 源码） | ui-workspace `src/client/membership-gate.ts`（dsh-src commit 594ff82e93，随 fork 产物覆盖进入镜像） | 每用户项目权限过滤（见 §4.2） |
| workbench 三栏        | profiles-web 装 fork dsh-workbench-plugin-0.1.35.tgz（gitee hq.com/dsh-workbeanch）                       | 三栏 UI，替代官方默认                                                          |

- 升级保险丝：Dockerfile 有断言，官方产物形态变化 → 构建显式失败提醒重适配

- 模板版本机制：profiles-web/.madazi-template-version 每次构建自增 → initContainer 版本门控铺到 PVC（当前 v155）

### 2.8 WebSocket 全景

| WS 路径                            | 处理方                              | 认证                                           | 说明                                       |
| -------------------------------- | -------------------------------- | -------------------------------------------- | ---------------------------------------- |
| /api/ws/presence                 | madazi-server                    | cookie/query JWT                             | 登录后在线状态（实时数据一律 WS，平台禁轮询）                 |
| /api/ws/preview-log              | madazi-server                    | cookie/query JWT                             | 预览日志（server WS → node 半缓存 → 前端 RPC 拉 1s） |
| /api/events.mux、/api/events.host | traefik → dsh-web（直连，豁免 server）  | forwardAuth                                  | dsh 事件流（曾 400=quda 丢 Upgrade 头/路径未覆盖）    |
| /socket.io、/ws                   | traefik/server upgrade → dsh-web | 登录门                                          | dsh 官方 WS                                |
| /api/projects/:id/ws             | server（setupProjectWS）           | **query/cookie 只认，Authorization 头 → 502/52** | 项目在线+任务推送                                |
| /api/projects/:id/terminal       | server                           | query/cookie                                 | 终端                                       |
| /api/projects/:id/collab         | server（Yjs）                      | query/cookie                                 | 协作                                       |

- server upgrade 分支（index.js）：/ws、/socket.io、/api/events → dsh-web；/terminal、/collab、/ws 项目级各自处理；其余预览域名异步判断

- 测试 WS：curl --http1.1 -N 带 Upgrade/Connection/Sec-WebSocket-\* 头（426 = HTTP/2 伪影，必须 --http1.1）

- **2026-09-03 实测**：/plugins/events（EventSource）在 HTTP/2 下曾偶发 ERR\_HTTP2\_PROTOCOL\_ERROR（→ connection lost, retry #N），quda nginx /plugins/ 加 proxy\_buffering off + proxy\_read\_timeout 3600s 缓解

### 2.9 预览链路

- 查询：GET /api/projects/previews/running（server，在 /api/projects 下）

- 预览 Pod：StatefulSet madazi-preview（造未运行须 scale --replicas=0；卡 Terminating 用 delete pod --grace-period=0 --force）

- 访问：pv-<id>.<YOUR-DOMAIN>.com 子域 → quda nginx → server 动态 podIP 代理（**短域名**，2026-09-01 起，替代长 /api/projects/:id/preview-proxy 路径）

- 空闲回收：server 60s 扫描孤儿 Pod（startIdleCleanup）

- 预览 Pod 内：Vite dev server + Node backend（3001，对齐 VITE proxy）——模板 AGENTS.md 强制要求 base URL 变量前缀、禁绝对 /api、禁改 base/proxy/hmr

### 2.10 数据层

- Postgres：postgres-deployment.yaml（postgres:16-alpine）；PVC madazi-postgres-pvc（5Gi，local-path）

  - 业务表：users、projects、project\_members、api\_keys、llm\_configs、usage\_logs、templates、template\_versions、settings 等

- Redis：事件总线（§2.12）纯内存，无持久化

- PVC madazi-projects-pvc（10Gi，local-path）：项目源码 /data/<uuid> + dsh 会话（JSONL+SQLite 索引，DSH\_HOME=/data/.dsh）+ 快照（/data/.dsh-sessions）+ 数据库文件（/data/.pgdata）+ 共享缓存（pnpm/npm/Maven/Go，硬链接）+ worktrees（/data/<uuid>-wt-\*）+ 模板库（/data/.madazi-templates）

- 配置：configmap.yaml（madazi-config）、secret.yaml（madazi-secret）——dsh-web 容器 envFrom 注入

- **存储拓扑（P2 拍板）**：保持 local-path，数据面单节点固定——local-path PV 带 nodeAffinity → colima-madazi，所有挂载方被自动钉在数据节点；无状态服务（redis/llm-gateway/traefik）可漂移

- **拒绝 NFS/Longhorn 原因**：①inotify 断裂（AI 改码→vite HMR 依赖同文件系统内核事件）②SQLite-on-NFS 锁语义 ③pnpm 硬链接同文件系统 ④构建 IO

- **数据保护**：PG 每日备份 scripts/backup-pg.sh（pod 内 pg\_dump+TOC 校验 → cat 流出 Mac → 双端 md5；全程不用 kubectl exec -i——colima ssh 不传播 stdin EOF 会永挂）；建议 crontab 0 4 \* \* \*

### 2.11 LLM 网关（madazi-llm-gateway，对话链路核心）

- 部署：k8s/llm-gateway-deployment.yaml；3459 / NodePort 30459（frp 7459）；探针 /healthz；GATEWAY\_GRANT\_USD=100

- **完整链路**：dsh 模型请求 → <https://<YOUR-DOMAIN>/llm/v1/>\* → quda nginx（/llm/ 直连 7459）→ frps:7459 → frpc → NodePort 30459 → gateway:3459 → 读 llm\_configs（DeepSeek base\_url+解密 key）→ 上游转发 → usage\_logs 记账

- **server 完全不在 LLM 路径上**——对话流式请求独立于 server，server 滚动更新不中断对话

- 模型配置：dsh settings 的 baseURL=<https://<YOUR-DOMAIN>/llm/v1；**llm_configs.user_id**：NULL=全局模型（admin> 配，全员可用），非 NULL=私有模型（用户自配 key，直连自己 base\_url）

### 2.12 事件总线（madazi-redis，P1 多副本前置）

- k8s/redis-deployment.yaml（redis:7-alpine，纯内存无 PVC）；server env REDIS\_URL=redis\://madazi-redis:6379

- src/services/bus.js：单频道 madazi:bus，JSON 帧，from=nodeId 回声去重

- 消息族（src/services/project-ws.js onBus 统一处理）：presence（15s 心跳+变更即报）、chat（协同对话跨副本 fan-out，excludeUserId 一致生效）、kick/reset（preview-log 推送/增量基线重置）、buildlog（生命周期事件镜像）

- **降级设计**：REDIS\_URL 未配置/连不上 → publish 仅本地 fanout（行为=单副本）；ioredis 自动重连恢复

- WS 连接/watcher/timer/增量基线**保持进程本地**——外移的只有「跨副本共享状态与 fan-out 决策」

***

## 3. 认证体系

- **JWT**（src/middleware/auth.js verifyToken）；登录：POST /api/auth/login → token

- **三通道取 token**（auth 中间件 / dsh-web-proxy isAuthed 同语义）：Authorization: Bearer / madazi\_token cookie / ?token= query

- **traefik forwardAuth 登录门**：dsh-auth middleware → server /api/auth/check（三通道判定 + X-Forwarded-Uri 取 query token）——dsh 数据面全部 API 先过登录门

- **WS 认证铁律**：project-ws.js 只认 query/cookie；Authorization 头 → 502/52

- **dsh 内层 BrowserAuth 已被 bypass**（trusted-host patch）：dsh 不再发签名 cookie，信任边缘 forwardAuth

- **登录插件**（dsh-plugin-login）：工作台登录表单遮罩 + 用户 chip + 登出；登录后自动为平台模型签发/校验 key 写入 DSH credential store；退出登录清 dsh.\* localStorage/sessionStorage 缓存

- 退出登录：setU(null) 切回登录表单（不触发整页 reload，避免 dsh 插件重载）

***

## 4. 权限模型

### 4.1 平台权限

- 角色：admin（系统管理员）/ user（普通用户）；项目角色：owner / admin / member（project\_members 表）

- **项目可见性**（GET /api/projects）：admin → 全部；普通用户 → owner\_id = me ∨ is\_shared = true ∨ project\_id ∈ project\_members(user\_id=me)

- 发起任务（session.prompt）/ 创建 workspace：仅项目成员角色

- 发布模板：需要 owner / 项目 admin / 系统管理员

### 4.2 membership gate（dsh 侧项目权限过滤，2026-09-01 起）

- 覆盖层注入 dsh-client-ui-workspace/lib/client.js：\_\_madaziRefresh() 每 30s（失败 5s 重试）fetch("/api/projects") 建 allowed Set（fail-closed）

- \_\_madaziIsDeniedPath(path)：从 workspace 路径 generated/<uuid> 提取 uuid → 不在 allowed 则隐藏

  - **正则（2026-09-03 修复）**：`new RegExp("generated\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\b", "i")`——new RegExp 字符串形式下 \b 正确成为单词边界；旧版正则字面量 \b 是字面量反斜杠+b，永远匹配失败 → 所有用户可见所有项目（已修复）

- 派生层 fail-closed 裁剪：deriveGroups / deriveFlat / deriveSearchResults 三通道统一拦（分组树/Ungrouped 桶/本地搜索），隐藏无权限 workspace 及全部 session

- SessionTree 用 useSyncExternalStore 订阅成员表刷新（\_\_madaziSnapshot 返回递增版本号）

### 4.3 LLM 模型权限

- llm\_configs.user\_id：NULL=全局模型（admin 配，可见/可用全员）；非 NULL=私有模型（仅该用户可见/可用）

- 普通用户只能建私有模型（user\_id 自动 set），只能改/删自己的；admin 可看全部

- 有私有默认模型 → workspace 直连私有 base\_url+key；无 → 回退全局网关

- **平台账号收敛**：所有 LLM 网关账号合并为单一 madazi-platform；私有模型用用户自 key（自费直连）

### 4.4 沙箱跨项目权限钳制（sandbox clamp，2026-09-05/06，详见 §13）

- **目标**：一个会话里「只能操作本项目文件 + 读取/写入自己有权限的其它项目」；无权限项目读写全拒；`danger-full-access` 重定义为「可写有权限项目」而非容器全盘

- 实现：wb-src host 插件 `sandbox-clamp.ts` wrap 官方 `sandboxPolicy.resolve / sandbox.confine / ctx.fs.writeText|editText|resolve` 四个出口（零注入扩展点）

- 权限根主体 = **最近活跃操作者**（`dsh_session_owners.active_user_id`，proxy 在会话 RPC 时更新），非会话归属者——防共享会话借归属者权限越权

- 映射下发 = **SSE 推送**（server `/api/dsh/access-map/events` → dsh-web 订阅，变更秒级生效，无轮询）

### 4.5 @引用（会话/文件）权限过滤（2026-09-05/06）

- **@会话候选**：proxy 将 `sessionReferenceResolver/candidates` 并入 SESSION\_LIST\_RPC（按 cookie 当前用户 me 过滤，与 sidebar 同口径）；host 侧 `session-ref-archive.ts` 按发起会话活跃者权限根 + 归档集合双重纵深过滤

- **@文件候选**：server `/api/projects/search-files` 按用户权限根过滤 + 客户端多源 `@` 触发源（23-cross-project-ref.js）

***

## 5. 模板市场（发布 → 审核 → 安装）

- **发布**：POST /api/market/templates/publish（owner/admin 权限）

  - 流程：密钥扫描 → collectPackageFiles → zip（sha256 内容寻址分桶落盘）→ 落库

  - **密钥扫描改提示不阻断（2026-09-03）**：scanProjectForPublish 命中项不再抛 422，改随成功响应返回 scanWarnings（前端成功页黄色提示「已发布，但检出 N 处疑似密钥内容」，列出 文件:行号·规则·掩码）；scanStats 照旧

  - 扫描规则：密钥文件（*.pem/*.key/SSH/云凭证 JSON/netrc）+ 内容 pattern（云 AK、PEM 块、GH/GL/Slack token、sk-、带密码 DB 连接串）

  - 私有发布 → 直接 published（仅作者可见）；公开发布 → pending 待审核

- **审核**（管理员）：工作台 dock → 「管理」（仅 admin，判定走 /api/auth/me）→ 「系统设置」→「模板审核」（待审数量徽标）

  - GET /api/admin/market/pending 拉队列；可展开 README 预览

  - 批准：POST .../versions/:versionId/approve → 版本 approved、模板 published、latest\_version 更新（全员可见）

  - 驳回：POST .../versions/:versionId/reject（body {reason}）→ 版本 rejected、模板 rejected、记录 review\_note

- **安装**：POST /api/market/templates/:slug/install → 安全解包（路径穿越/绝对路径/symlink 拒绝）→ 一键建项目

- 前端：madazi 插件 17-market.js（市场浏览/发布向导/详情/评分）

***

## 6. 插件体系（dsh-web 宿主，零注入原则）

- **宿主**：dsh-web（apex 根路径直指；7456 是 web-proxy 非本体）

- **dsh-plugin-madazi**（madazi-server/docker/acp/plugins/dsh-plugin-madazi/lib/src/，22 个模块 build.cjs 拼接）：

  - 00-setup 环境初始化 / 01-css 样式 / 02-typert Typert manifest

  - 03-shared 共享工具 / 04-create-form 项目创建向导（模板网格+error 共存）

  - 05-projects 项目列表与选择 / 06-platform 个人面板+成员管理弹窗

  - 07-admin 管理后台（用户/三方登录/用户 Key/系统设置-含模板审核、预览回收）

  - 08-preview 预览控制 / 10-fetch-online 在线状态

  - 11-members-overlay 成员管理浮层 / 12-meta-reporting / 13-ordering

  - 14-workspace-title 侧栏标题 / 15-apply slot 注入主入口

  - 16-preview-control 预览启停 / 17-market 模板市场 / 18-skills 技能 / 19-share-skill

  - 20-skill-market-overlay / 21-oauth-settings / 22-browser-agent AI 浏览器控制

  - slot 注入点：settings.section（管理/插件市场）、sidebar 项目树、skills 等

- **dsh-plugin-login**：登录表单遮罩 + 用户 chip + 登出 + key 自动签发

- **dsh-workbench-plugin**（fork 0.1.35）：三栏工作台 UI

- 用户管理：madazi-admin-user-row 类名（避免触发 login 插件侧栏用户菜单 Popover）；重置密码走 PUT /api/admin/users/:id/password

***

## 7. 内置浏览器 & AI 浏览器控制（BrowserView + 22-browser-agent）

- **内置浏览器**：BrowserView iframe 只挂活跃 tab；地址栏显示完整预览 URL（含 hash 路由）；纯 hash 输入（#/xxx）append 到当前预览 URL，经 set-hash 指令改 location.hash 不整页 reload

- **导航规则**：/-开头路径视为绝对（/api/...），不做目录拼接；block 127.0.0.1/localhost/\[::1] 并返回当前项目预览域；绝对预览域导航走 /git/browser/view?u=... 代理壳页（保留注入脚本）

- **AI 浏览器控制**（browser-agent.ts host + 22-browser-agent.js client，deepseek-harness 集成）：

  - 定向派发：指令关联发起者 sessionId+tabId，host 维护 activeTabs Map（心跳），仅发起会话的活跃窗口响应、显示覆盖层（takeoverBySession 隔离）

  - 覆盖层每 500ms 重定位跟随 iframe；用户鼠标保持可见（不 cursor:none）但拦截点击（pointer-events:auto）

  - 打开浏览器：优先当前会话预览 URL → 最近历史 → 项目列表；先启动并验证预览运行

  - 注入脚本就绪检测（frame.contentWindow\.__DSH\_BROWSER__）再 postMessage；命令泵 tick 级 try-catch 保连续

  - 页面数据增删改一律走浏览器操作（browser\_click/browser\_type）确保实时视觉反馈，禁止 shell 直改库

- SVG 快照背景用计算页背景色（防 JPEG 黑底）；ensurePointerTrack try-catch 防跨域 SecurityError

***

## 8. 部署 / 运维链路

```bash
# 镜像构建（必须指定 colima docker socket）
export DOCKER_HOST=unix://$HOME/.colima/madazi/docker.sock
cd ~/code/madazi/madazi-server && docker build -t madazi-server:<新tag> .
# 导入 k3s（★必须 k3s ctr；换镜像用新 tag，latest + IfNotPresent 会复用旧镜像）
docker save madazi-server:<新tag> | colima ssh -p madazi -- sudo k3s ctr -n k8s.io images import -
# 部署（deployment yaml 里 image 指向新 tag 再 apply）
cat k8s/server-deployment.yaml | colima ssh -p madazi -- sudo k3s kubectl -n madazi apply -f -
colima ssh -p madazi -- sudo k3s kubectl -n madazi rollout status deployment/madazi-server --timeout=180s
# configmap 改动（如 dsh-web-nginx）必须 rollout restart 对应 deployment
```

- **dsh-web 一键构建部署**：\~/code/madazi/scripts/build-dsh-web.sh（0b 插件 build.cjs → 1 wb-src pack tgz → 2 同步 profiles-web → 3 pnpm lockfile → 3c 模板版本自增 → 4 docker build → 5/5b/5c/5d/5e 镜像内验证 → 6 ctr 导入+rollout → 7 线上验证）

  - 前置：wb-src/lib/client.js 必须是最新版（含日志文案标记）；cd \~/code/wb-src 构建

- 覆盖层重建：已随 fork 退役（2026-09-12）。membership gate 在 dsh-src `packages/client/ui-workspace/src/client/membership-gate.ts` 源码修改，`pnpm run build:lib:client` 后由 build-dsh-web.sh 3d 同步覆盖进入镜像

- quda 侧改 nginx：cp 备份 → 改 → sudo nginx -t → sudo nginx -s reload

- 磁盘清理：docker container prune -f && docker image prune -f（保持 vdb1 <80%）

***

## 9. 故障排查速查表（实战教训）

| 症状                                           | 根因                                            | 修法                                                                             | <br />                                                                                                     |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------- |
| 全站 WS 502 / presence 502                     | quda nginx 改配置未 reload（进程 7/27 vs 配置 8/21）    | nginx -t && nginx -s reload                                                    | <br />                                                                                                     |
| events.mux WS 400                            | quda if ($http\_upgrade) 块丢 WS 头 / 路径没分流      | 删 if 块恢复透传（/api/ 已带头）                                                          | <br />                                                                                                     |
| host./settings./credentials.describe 400/502 | quda rewrite 成 /dsh-web/api/ 前缀，3081 不认       | 删 rewrite，恢复 /api/ 透传                                                          | <br />                                                                                                     |
| POST /api/skills/list 404                    | traefik 平台正则 skills(?:/                       | $) 劫持到 server（无该端点）                                                            | 三表同步：PLATFORM\_API 负向前瞻 + traefik PathRegexp(^/api/skills/list$) p1100 + nginx location = /api/skills/list |
| 所有用户可见所有项目                                   | membership gate 正则字面量 \b 非单词边界 → 匹配永远失败       | 改 new RegExp("generated\\/(uuid)\b","i") 字符串形式                                 | <br />                                                                                                     |
| 首次登录「连接失败」需点击                                | /plugins/events(SSE) 在 HTTP/2 反代下被缓冲→停滞误判→RST | quda nginx /plugins/ 加 proxy\_buffering off + proxy\_read\_timeout 3600s       | <br />                                                                                                     |
| TypeError: t is not a function（SessionTree）  | \_\_madaziVersion 函数与变量同名冲突                   | 函数改 \_\_madaziSnapshot（返回数字版本号）                                                | <br />                                                                                                     |
| web-proxy 就绪探针 401                           | alpha.5 BrowserAuth 锁根路径，探针无 token            | 新增 nginx location = /readiness 200，探针指向 /readiness                             | <br />                                                                                                     |
| dsh web authentication required              | alpha.5 BrowserAuth 强制                        | trusted-host bypass patch（信任边缘 forwardAuth）                                    | <br />                                                                                                     |
| 镜像 ImagePullBackOff not found                | 导入到系统 containerd 而非 k3s 的                     | k3s ctr -n k8s.io images import -                                              | <br />                                                                                                     |
| 部署后行为不变                                      | imagePullPolicy IfNotPresent 复用旧镜像            | 新 tag + ctr import + deployment 改 tag                                          | <br />                                                                                                     |
| 之前导入的镜像几小时后消失（ErrImageNeverPull）             | docker 构建 junk 超 85% 触发 kubelet 静默删 k3s 镜像    | docker container prune -f && docker image prune -f → 重导 + preview/stop 再 start | <br />                                                                                                     |
| 浏览器报旧错                                       | 旧 bundle 缓存（rev 混杂）                           | 硬刷新 Cmd/Ctrl+Shift+R                                                           | <br />                                                                                                     |
| WS 测试 426                                    | HTTP/2 伪影                                     | curl 加 --http1.1                                                               | <br />                                                                                                     |
| 预览子域 302                                     | pv 域 302 → preview-proxy 属正常                  | 不是故障                                                                           | <br />                                                                                                     |
| 验证 dsh RPC 是否到达 dsh 核心                       | pod 内 curl 127.0.0.1:3081/api/<method>        | 200=dsh 侧问题；404/400=路由/前缀问题                                                    | <br />                                                                                                     |
| 密钥扫描阻断发布                                     | 旧逻辑命中即 422                                    | 已改 scanWarnings 提示不阻断（2026-09-03）                                              | <br />                                                                                                     |

***

## 10. 健康检查 / 探针一览

| 端点              | 位置                      | 用途                          |
| --------------- | ----------------------- | --------------------------- |
| /api/health     | server                  | server readiness/liveness   |
| /api/auth/check | server                  | traefik forwardAuth 登录门判定   |
| /readiness      | dsh-web web-proxy nginx | web-proxy 就绪（绕 BrowserAuth） |
| /ping           | traefik (8080)          | traefik readiness/liveness  |
| /healthz        | llm-gateway             | gateway readiness/liveness  |

***

## 11. 变更联动（改一处必须检查）

1. **新增 dsh RPC** → 零配置自动通（路由反转后 /api/\* 非 Platform 家族全 fall-through；若 404 先查 pod 内 dsh 核心是否注册该方法）
2. **新增平台 API 路由家族** → 同步三处：server dsh-web-proxy.js PLATFORM\_API 正则 + dsh-web-deployment nginx 白名单正则 + traefik-routes.yaml（及 helm templates/traefik.yaml）IngressRoute 家族正则（漏 server 侧 = 请求被转发给 dsh 404；漏 pod 侧 = server↔pod 代理环路；漏 traefik 侧 = 公网被 forwardAuth 误拦 401 或误投 dsh-web）

   - **skills/list 特例**：dsh 技能 RPC 需要「精确排除」→ 三处负向前瞻/精确 location/高优先路由都做（RE2 无负向前瞻，traefik 用 PathRegexp 精确匹配）
3. **改 quda nginx** → 备份 + reload；主站块必须带 WS Upgrade 头；SSE 路径建议 proxy\_buffering off
4. **换镜像** → 新 tag + k3s ctr 导入 + deployment 同步
5. **改 configmap** → apply 后必须 rollout restart
6. **加 frp 端口** → /etc/frpc.toml + frpc 重启 + quda frps 放行
7. **升级 dsh** → 同步重建覆盖层（membership gate）+ 重验 trusted-host/loopback/timeout/skill 补丁 + 更新 Dockerfile 版本断言（dsh-client-ui-workspace version + plugin tgz）
8. **改模板** → 拷到 PVC + 升 .madazi-template-version（热更新）；旧项目模板不自动更新
9. **改插件** → node lib/build.cjs 重建 client.js + 跑 build-dsh-web.sh（模板版本自增触发铺 PVC）
10. **改会话权限映射/权限根** → 三处联动：`dsh_session_owners.active_user_id` 更新点（dsh-web-proxy 会话 RPC 拦截）→ `session-access-map`/`access-map/events` 端点（dsh-meta.js）→ dsh-web `sandbox-clamp.ts` accessMap（SSE 订阅刷新）；bumpAccessMap() 必须覆盖**所有**变更点（归属反写/session-owner/members 增删/admin 角色/活跃操作者）
11. **@候选权限过滤** → proxy SESSION\_LIST\_RPC 正则（含 sessionReferenceResolver/candidates）+ host session-ref-archive.ts 双重；改一侧必须同步另一侧口径

***

## 12. 边界与红线（用户拍板）

- 前端/代码一律用**最新 wb-src**（直连 WS preview-log?projectId），不回滚助手版

- 实时数据一律 WS 推送（用户反感轮询）；轮询仅兜底

- madazi 集成 dsh = **零注入**：功能走官方扩展点（RPC/slots/agent 工具/插件），弃 DOM hack

- 插件宿主 = dsh-web（apex 根路径直指；7456 是 web-proxy 非本体，7088 已下线）

- 生产级多副本、平台多项目多任务并发 AI 协同禁串行

- 项目删除必须清干净所有 per-task PVC 数据（/data/<uuid>、-wt-*、--app-generated-<uuid>*-- 会话、.pgdata、DSH\_SNAPSHOT）

- 密钥扫描发布时仅提示不阻断（用户拍板 2026-09-03）

***

## 13. 沙箱跨项目权限钳制（sandbox clamp，2026-09-05/06）详解

### 13.1 问题背景

官方 dsh 沙箱的 `danger-full-access` 模式（用户给 AI 的「完全权限」）语义 = **容器内全盘读写**：

- `terminal-bash spawnArgv` 见 `danger-full-access` 直接裸跑（不进 Landlock）

- fs-sandbox `checkedTarget` 对 danger 原样放行（不校验）

- 读操作全档位透传，Landlock `readOnly: '/'` 全盘可读

而 dsh-web 是**共享单实例**（所有用户/项目的会话在同一个进程 + 同一份 `/app/generated`），因此 danger 模式 = 一个用户能读写**全部项目**——这是多租户下的根本漏洞。

### 13.2 目标语义（用户拍板）

一个会话里：

| 维度          | 语义                                                    |
| ----------- | ----------------------------------------------------- |
| 写           | 当前项目（workspace-write）或「**活跃操作者有权限的所有项目**」（danger 重定义） |
| 读           | 系统运行目录（白名单）+ 有权限项目；无权限项目读写全拒                          |
| fail-closed | 任何不确定（新会话未登记/平台不可达/wrap 异常）→ 退回仅当前项目，宁可少权限            |

### 13.3 实现（全部官方扩展点，零注入）

host 插件 `wb-src/src/host/sandbox-clamp.ts` 遮蔽四个官方出口：

1. **`sandboxPolicy.resolve`**（唯一 mode 权威出口）——danger → 压成 workspace-write，附加 `__madaziReadRoots/__madaziWriteRoots`；catch 也压级（fail-closed）
2. **`sandbox.confine`**——Landlock grant 重建：读面 = 系统白名单 + 有权限项目根；写面 = /dev/null + /tmp + 有权限项目根；**全部路径过 existsSync**（防幽灵/不存在路径导致 launcher exit 125 全挂）；bwrap 分支仅扩写根（防御性）
3. **`ctx.fs.writeText/editText`**——target 匹配写根才放行（构造 per-call policy 复用官方 containment），越界抛 FS\_SANDBOX\_DENIED；policy 无附加根 → 单根兜底
4. **`ctx.fs.resolve`**——读边界校验（带 cwd 的读链路用 cwd 反查会话读根交集），越界抛 FS\_NOT\_FOUND

### 13.4 权限根来源：会话 → 活跃操作者 → 权限根

```
dsh_session_owners(user_id 归属 / active_user_id 活跃)
   │  proxy 会话 RPC 拦截：非 list 请求更新 active_user_id = me（cookie 当前用户）
   ▼
session-access-map 端点：COALESCE(active_user_id, user_id) 作为权限主体 → 权限根列表
   │  bumpAccessMap()（归属/成员/角色/活跃变更点）→ SSE changed
   ▼
dsh-web sandbox-clamp accessMap（模块级共享，@候选过滤也复用）
```

- **为什么用活跃操作者而非归属者**：会话共享（项目级可见），user2 打开 admin 的会话时归属者是 admin——按归属者发权限根 = user2 借会话继承 admin 全部项目权限（实测越权）；按最近活跃操作者 = 谁操作按谁发

- **为什么 SSE 推送而非轮询**：用户反感轮询；权限撤销（移出项目/降级）必须秒级生效，轮询有窗口

- **防抖/重连**：5s 防抖合并 + 指数退避重连（1s→30s）+ 重连全量重同步

### 13.5 实战踩坑记录（勿重犯）

| 坑                                            | 症状                                                  | 修复                       |
| -------------------------------------------- | --------------------------------------------------- | ------------------------ |
| 读面收窄成系统目录白名单，arm64 无 /lib64                  | landlock `cannot open rule path` exit 125 → bash 全挂 | 读面全部过 existsSync，缺路径自动跳过 |
| 权限根含幽灵路径（项目已删但 DB source\_path 在，如 30527f8f） | 同上 exit 125                                         | 写根/读根统一 existsSync 过滤    |
| ctx.set 未 provide                            | 插件加载崩溃（工作台 404）                                     | 改模块级导出共享 accessMap       |
| resolve catch 返回原始 policy                    | wrap 异常 = danger 全盘（fail-open）                      | catch 也压级单根              |
| wrapWrite policy 无附加根                        | 放行官方 danger                                         | 单根兜底                     |
| 共享会话按归属者发权限根                                 | user2 借 admin 会话越权写他人项目                             | active\_user\_id 活跃操作者主体 |

