# dsh 升级指南（DSH Upgrade Guide）

> 适用范围：madazi 平台对官方 DeepSeek Harness（dsh）的深度集成。升级 dsh 前必读本文件 + `docs/ARCHITECTURE.md`（尤其第 6 节「变更联动」）。

## 1. 为什么需要本文件

madazi 集成 dsh 遵循「零注入」原则（官方扩展点），但为了项目权限隔离做过**渲染源头同源构建覆盖**与**部署层外科补丁**。这些侵入点必须随 dsh 升级同步演进，否则会静默破坏。

**当前基线：dsh `0.1.2-rc.1`**（2026-09-03 由 `0.1.2-alpha.5` 收敛，产物字节级一致，覆盖层/补丁复用；上一基线 `0.1.1-rc.2`）。

## 2. 侵入点全景

| # | 侵入点 | 位置 | 职责 | 升级影响 |
|---|---|---|---|---|
| 1 | membership gate（已迁 fork 源码） | dsh-src `packages/client/ui-workspace/src/client/membership-gate.ts`（commit 594ff82e93，随 fork 产物覆盖进入镜像） | per-user 项目权限门（fetch `/api/projects` 建成员表 + derive 派生层 fail-closed 裁剪：deriveGroups/deriveFlat/deriveSearchResults） | 🟡 升级合并 ui-workspace 改动（git merge 冲突即保险丝） |
| 2 | BrowserAuth trusted-host 旁路 | Dockerfile patch `dsh-client-connection/lib/index.js`（`requestRejection` 401→void 0、`authorizeIndex`→true） | alpha.5 强制 BrowserAuth（`/` 与 `/api` 都要随机 token 换签名 cookie）；由 traefik forwardAuth 登录门兜底，故跳过 dsh 内层 cookie 检查。`isTrustedApiRequest` 前位守卫保留（不可信 host 仍 403） | 🔴 anchor 形态变化即构建失败 |
| 3 | loopback 围栏放宽 | Dockerfile patch `dsh-client-connection/lib/client.js` `isLoopback` + `index.html` 注入 `__DSH_TRUSTED_LOOPBACK__` | 模型设置 tab 走 `memory` 模式（view 永远 undefined）问题：web 公网域名访问时 isLoopback 额外认可注入标记，模型设置可用 | 🔴 anchor 形态变化即构建失败 |
| 4 | 技能目录「唤起即刷新」 | Dockerfile patch `dsh-client-ui-skill/lib/client.js` `candidates` 先 `invalidate(sessionId)` | 新技能写入后 `/` 菜单立即带出最新目录（host watcher 已刷，client 侧跟不上的缓存问题） | 🔴 anchor 形态变化即构建失败 |
| 5 | 版本保险丝 | Dockerfile `RUN node -e '...v!=="0.1.2-rc.1" exit(1)'`（ui-workspace override 版本断言） | 防止旧覆盖层盖新包 | ✅ 升级时改版本号 |
| 6 | connection 超时 sed | Dockerfile `streamOpenTimeoutMs: 3e3 → 12e3` | 冷启动首波 5s+ 撞 3s 超时 → 会话列表空窗 | 🔴 写法失配（有自动失败保护） |
| 7 | server 数据层过滤 | `madazi-server/src/services/dsh-web-proxy.js`（session.list 响应过滤）+ `session-access.js` + `permission.js` | 服务端 fail-closed 会话隔离 | 🟡 响应形状变化 |
| 8 | 插件 DOM 补丁 | `dsh-plugin-madazi`（startRowMeta/startSessionOrdering/ownerChips/bubbleSenders） | 成员行元数据、排序、署名等增强 | 🟡 sidebar 结构变化 |
| 9 | nginx sidecar | `k8s/dsh-web-deployment.yaml` + `deploy/helm/madazi/templates/dsh-web.yaml` | gzip、rev 化 bundle immutable 缓存、`/plugins/events` SSE 直通、`location = /api/skills/list` 精确转发 | 🟢 版本无关 |
| 10 | 平台 API 路由分流（三表同步） | `dsh-web-proxy.js` `PLATFORM_API` 正则 + web-proxy configmap 白名单 + `k8s/traefik-routes.yaml` IngressRoute | 平台 API 家族与 dsh 数据面分流（见 §6.5 三表同步义务） | 🔴 新增平台路由必同步 |

## 3. 影响分级

### 🔴 升级必动（否则直接坏）
- **fork 升级重放**（2026-09-12 起，运行期补丁/覆盖层均已退役为 fork 源码）：见 [docs/dsh-fork.md §5 升级 runbook](dsh-fork.md)——dsh-src git merge 官方 tag 重放 madazi 定制；`git apply --check patches/*.patch`（源码布局）命中校验；本地 `pnpm build` 后由 build-dsh-web.sh 3d 同步产物并保险丝验证
- **外科补丁重打（历史 0.1.5 及更早）**：BrowserAuth 旁路 / loopback 放宽 / 技能刷新三个 Dockerfile `node -e` 补丁已随 fork 退役（Dockerfile 内已删除），仅旧镜像/旧档适用；现在的保险丝 = fork 产物 grep（loopback 代码标记 + invalidate + gate 标记）
- **sed 补丁适配**：确认官方 `streamOpenTimeoutMs` 产物写法；若官方已修超时 → 删除整块

### 🟡 升级后必冒烟
- **server 列表过滤**：响应形状再变 → 过滤失效（权限降级但不崩，客户端 gate 双保险）
- **插件 DOM 补丁**：sidebar 结构变 → 增强失效/误伤（主裁决器已退役，风险已降）
- **session 归属解析**：依赖 dsh `cwd` 路径约定（`/app/generated/<projectId>`），一般稳定

### 🟢 几乎无影响
- nginx 配置、PVC 模板铺设机制（幂等）、server 自有代码

## 4. 升级操作手册（六步）

```bash
# 1. 升级 LSD 核心
cd ~/code/deepseek-harness   # 或直接 docker 内 npm i -g @deepseek-ai/dsh@<新版本>
# 注意：0.1.2-alpha.5 的 membership gate 已从「harness fork 源码补丁(membership-filter 分支)」
# 改为「官方产物 + build-override-membership.mjs 注入」，无需再重放 fork patch。
# 升级时对齐 Dockerfile 顶部锁定的官方版本。

# 2. 全量构建 + 验收
cd ~/code/madazi/dsh-src && corepack pnpm install && corepack pnpm run build   # 全量（含 native/lib/web）
# 产物须含 fork 定制标记（build-dsh-web.sh 3d 保险丝同理）：
grep -qE "startMembershipWatch|gatedWorkspaces|api/projects" packages/client/ui-workspace/lib/client.js
grep -q "__DSH_TRUSTED_LOOPBACK__" packages/client/connection/lib/client.js
grep -q "invalidate(session.sessionId)" packages/client/ui-skill/lib/client.js

# 3. （覆盖层重建已退役：2026-09-12 fork 后 gate 是 ui-workspace 源码，随产物自含）

# 4. 更新 Dockerfile 关键点
#   - 版本保险丝: "0.1.2-rc.1" → 新版本（ui-workspace override 版本断言）
#   - 外科补丁 anchor: BrowserAuth 旁路 / loopback 放宽 / 技能刷新 三处，
#     官方产物形态若变 → 构建报 ANCHOR MISSING / PATCH FAILED，须按新结构重打
#   - sed 补丁: 确认官方 streamOpenTimeoutMs 写法（已修则删整块）

# 5. 部署
bash scripts/build-dsh-web.sh

# 6. 冒烟清单（见 §5）
```

## 5. 冒烟清单（升级后必测）

- [ ] admin 会话列表显示（v73 修复项：项目下会话行不再 display:none）
- [ ] user1 隔离：picker 下拉只列有权项目、Ungrouped 桶、local 搜索、移除成员后 ≤30s 收敛
- [ ] 冷启动加载：刷新后无 30s+ 空窗（覆盖层 + sed + SSE 直通协同）
- [ ] 非成员会话数据面 403（server 过滤仍生效）
- [ ] 插件功能：项目行成员头像/管理按钮、会话排序、创建人 chip、气泡署名
- [ ] 公网入口 HTTP 200、PVC 模板版本自增、`/plugins/events` 直通（EventSource 秒开）
- [ ] **BrowserAuth 直通**：未登录访问工作台 → forwardAuth 登录门拦截；登录后 `/` 与 `/api` RPC 均 200（trusted-host 旁路生效），不可信 Host 仍 403
- [ ] **模型设置 tab**：设置 → 模型 可用（loopback 放宽 + `__DSH_TRUSTED_LOOPBACK__` 生效，非 `memory` 模式）
- [ ] **技能目录刷新**：新增技能后 `/` 菜单立即带出（技能 invalidate 补丁生效，非旧缓存）
- [ ] **平台 API 路由回归**：`POST /api/skills/list` 200（非平台劫持）、成员类平台 API 仍走 madazi-server（见 §6.5 三表同步）

## 6. 关键遗留与长期建议

### 6.1 已退役的 DOM 补丁
- `startUngroupedSessionFilter`（v63/v64 时代「会话可见性单一裁决器」）已退役（2026-08-28）：它用 title 精确匹配 byId 判定行归属，匹配失败即 fail-closed 隐藏，误杀成员项目会话行（症状：有项目无会话）。其职责已由覆盖层 derive gate + server 数据层完整接管。**升级重放时不要再启用**。

### 6.2 仍在运行的 DOM 补丁（治理目标）
- `startRowMeta`：项目行下方注入创建人/在线成员头像/管理按钮（功能增强）+ 组级成员执法（`madaziMember` dataset → `setSectionHidden`）。依赖 sidebar 项目行 DOM 结构（首子元素 svg + `aria-expanded` + 第 3 子元素 span），结构变化会使其失效（降级为不显示成员增强，不影响权限——权限已由覆盖层 derive gate 兜底）。
- `startSessionOrdering` / `startSessionOwnerChips` / `startBubbleSenders`：排序与署名增强，同理依赖 DOM 结构。

### 6.3 升级时优先观察
- dsh 官方是否把「成员权限 / 会话归属」做成原生功能 → 若落地，可整体拆除覆盖层 + gate 层（回归纯官方）
- dsh 官方是否修复 `streamOpenTimeoutMs` 过短问题 → 移除 sed 补丁
- 新版本 sidebar 结构变更对 DOM 补丁的影响

### 6.4 升级策略
- 小步升级（rc 级），每次按 §4 手册 + §5 冒烟走完，别跳版本
- 升级前备份：harness 分支 tag、当前镜像 tag、覆盖层目录、Dockerfile

### 6.5 平台 API 路由家族 → 三表镜像同步（新增平台路由必守）
路由反转后，`/api/*` 非平台家族全 fall-through 到 dsh；但**新增/改动平台 API 路由家族时，三表必须一起改**，漏一处 = 404、401 或 server↔pod 环路：
1. `madazi-server/src/services/dsh-web-proxy.js` 的 `PLATFORM_API` 正则
2. web-proxy configmap 白名单
3. `k8s/traefik-routes.yaml` IngressRoute 正则（**RE2 不支持负向前瞻**——如 `skills(?!\0...)` 这种 JS 写法在 traefik 里不成立，需用「精确路由 + 更高 priority」表达排除，例：`POST /api/skills/list` 独立一条 `PathRegexp(^/api/skills/list$)` priority 1100 指向 dsh-web）
> helm chart 同步义务：`deploy/helm/madazi/templates/traefik.yaml` 的 IngressRoute 正则须与 `k8s/` 裸清单保持一致。
**实例（2026-09）**：`POST /api/skills/list` 曾被 `skills(?:/|$)` 平台正则劫持到 madazi-server → 404。修复 = 平台 `PLATFORM_API` 加 `skills(?!\/list(?:\/|$))` 负向前瞻 + nginx `location = /api/skills/list` 精确转发 + traefik 精确路由 priority 1100。

## 7. 回滚预案

- **覆盖层回滚**：从 Dockerfile 移除覆盖层 COPY 块 + 保险丝，重跑 `scripts/build-dsh-web.sh`（回到官方行为，权限隔离降级为 server 层）
- **整机回滚**：`ctr` 回导上一版本镜像 tag + rollout
- **分支回滚**：harness `git checkout <上一基线>` 重建覆盖层
- **BrowserAuth 回滚**：若 trusted-host 旁路 anchor 失效导致全体 401，可临时只移除该旁路 + 回退到 `0.1.1-rc.2` 镜像，或按新结构重打（勿同时去掉 forwardAuth 登录门——边缘门是真正鉴权边界）

## 8. 侧边栏 slot 架构（附录：理解 §2 侵入点的设计基础）

dsh 侧边栏不是写死的 UI，而是 **官方插件 `@deepseek-ai/dsh-client-ui-sidebar` 提供 shell + 槽位（slot）框架**，各区域由插件通过官方扩展点 `slots.register` / `slots.inject` 填充（零注入）。slot 契约声明于 `packages/client/ui-sidebar/src/client/contract/slots.ts`：

```
┌──────────────────────────────────────┐
│ sidebar.brand.mark    品牌图标        │ ← 任何插件可注册（single/root）
│ sidebar.brand.name    品牌名          │ ← 任何插件可注册
├──────────────────────────────────────┤
│ sidebar.workspaces    工作区浏览区    │ ← @deepseek-ai/dsh-client-ui-workspace 填充
│                      （项目树/会话树/ │   ★ 本仓库覆盖层即改此占用者
│                        搜索/拖拽）    │
├──────────────────────────────────────┤
│ sidebar.settings      设置入口        │ ← ui-settings
│ sidebar.footer.action 底部动作        │ ← 任意插件（list/root）
└──────────────────────────────────────┘
```

### 8.1 自定义分层与现状

| 层 | 可否自定义 | 现状 |
|---|---|---|
| slot 占用者（ui-workspace 的 WorkspaceBrowser） | ✅ | **已自定义**：覆盖层 = 渲染源头 gate（`build-override-membership.mjs` 注入 derive 层裁剪，非源码 fork） |
| 其它 slot（brand/settings/footer.action） | ✅ 官方扩展点 | 未动，可随时注册插件填充 |
| 侧边栏 shell（ui-sidebar 整体布局） | ✅ 同源构建可改 | 未动（收益低、风险高） |
| 完全替换工作区浏览区（自写插件替代 ui-workspace） | ✅ 理论上 | 不采用——ui-workspace 已含成熟树/拖拽/搜索，只需在内部加门 |

### 8.2 设计结论

- 覆盖 ui-workspace 是「自定义该 slot 占用者」而非「hack 侧边栏」——符合 slot 架构初衷（插件独立、可替换、官方扩展点注入）
- 所有改动在 ui-workspace 包内部，不破坏 slot 契约 → **升级时 slot 契约不变则覆盖层无需架构性重写**
- **退出路径**：若官方 ui-workspace 原生支持成员权限，仅需撤掉覆盖层 + 保险丝，slot 自动回落官方实现，零迁移成本
