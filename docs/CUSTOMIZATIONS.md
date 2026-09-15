# madazi 平台自定义清单（在官方 dsh 之上改了什么、为什么）

> 本文件面向维护者：完整列出 madazi 对官方 DSH（dsh-web 0.1.5-rc.1）的所有定制，
> 每一项给出「改了什么 / 为什么 / 升级联动」。「零注入」红线：功能一律走官方扩展点
> （RPC / slots / agent 工具 / host 插件实例遮蔽），弃 DOM hack。升级 dsh 时按本清单逐项复核。

## 为什么要这么分层（先读这个）

> ⚠️ 2026-09-12 已拍板：本条"刻意不 fork 内核"的分层机制是**过渡态**。全面 fork 方案见
> [docs/dsh-fork.md](dsh-fork.md)：① 运行期补丁与 ② 覆盖层将迁入 `dsh-src/` 源码 fork
> （git 历史可见），patches/*.patch 已重写为源码布局标准 git patch。本文档其余章节
> 仍描述当前部署（npm 包 + 运行期补丁）的现状，待 ① ② 退役后同步更新。

官方 dsh = 内核（@deepseek-ai/dsh 依赖树）+ 官方前端（dsh-web-frontend / dsh-client-*）+ 插件体系。
madazi 的定制**刻意不 fork 官方内核源码**，而是分三层改：

| 层 | 手段 | 升级成本 |
|---|---|---|
| ① 运行期补丁 | Dockerfile `RUN node -e` 外科改写官方包产物 | 低：重验锚点（grep），保险丝自动拦 |
| ② 覆盖层 | 自建 client.js **整包覆盖**官方 `dsh-client-ui-workspace`，构建期版本断言强制匹配 | 低：官方包版本变即失败，重建覆盖层 |
| ③ 前端 fork | `wb-src/` 整体 fork 官方 Web UI 并打包成 workbench 插件（MIT） | 中：fork 独立演进，升级需 merge 校验 |

**为什么不改官方源码再打包**：fork 内核 → 每次官方升级都是 merge 战争；现结构让近两次升级
（0.1.2→0.1.5-rc.1）一次平滑通过。补丁/覆盖层集中管理在此仓库，升级只需按文末清单重验。

***

## A. 部署与构建层

### A1. dsh-web 一体化镜像 + 模板版本门控

- **改了什么**：`madazi-server/docker/acp/Dockerfile.dsh-web`（FROM madazi-dsh）+ `profiles-web/` 模板目录 + initContainer 版本门控铺 PVC（`.madazi-template-version`）

- **为什么**：官方 dsh 只支持单机绑定 127.0.0.1；平台需要公网多用户共享单实例。镜像把「三栏工作台模板 + 插件树」固化，initContainer 按版本号把插件/模板增量铺到共享 PVC（改插件无需重建镜像）

- **升级联动**：改 tgz/插件后必须升 `.madazi-template-version`；否则 PVC 永远跑旧插件

### A2. dsh-web nginx sidecar（3080 → 3081）

- **改了什么**：web-proxy 容器（nginx:alpine）：rev 化长缓存（/assets /plugins）、SSE 直通（/plugins/events 关缓冲）、平台 API 白名单回流 server、skills/list 与 llm RPC 精确转发

- **为什么**：官方 dsh 只绑 127.0.0.1；sidecar 对外暴露 + 平台 API 家族从 pod 内回流 server（避免公网二次打 traefik 环路）

- **升级联动**：白名单正则必须与 server `PLATFORM_API` 三表同步（见 ARCHITECTURE §11）

### A3. server 镜像 + 会话数据层反代网关（dsh-web-proxy.js）

- **改了什么**：server 内部 `setupDshWebProxy`：外部 /api/\* 先到 server，平台家族留用，其余反代 dsh-web；会话 RPC 按 sessionId 鉴权（SESSION\_RPC）、列表按项目过滤（SESSION\_LIST\_RPC）、创建按归属校验

- **为什么**：dsh 是共享单实例（会话全局可见），必须由网关做「会话数据层权限」——读消息/发消息/操作已有会话按会话归属项目校验操作者成员身份

- **升级联动**：dsh 升级 RPC 形态（点号↔斜杠）时同步正则

***

## B. 官方产物补丁（Dockerfile RUN node -e / sed）
> 每个补丁有独立说明文件（含 before/after diff 与升级重验动作）：
> `madazi-server/docker/acp/patches/NNN-*.patch`

### B1. trusted-host 直通（绕过 alpha.5 强制 BrowserAuth）→ patches/03-trusted-host-bypass.patch

- **改了什么**：patch `dsh-client-connection/lib/index.js`：`browserAuth.isAuthenticated → void 0`、`authorizeIndex → true`

- **为什么**：alpha.5 起 dsh 强制 BrowserAuth，公网用户拿不到进程启动时的随机 token → 全站 401；平台的鉴权边界在 traefik forwardAuth 登录门（dsh-auth 已拦所有 /api），dsh 内层 cookie 是冗余墙

- **升级联动**：官方产物形态变化 → grep 不匹配则构建显式失败提醒重适配

### B2. loopback 围栏放宽（模型设置 tab）→ patches/01-loopback.patch

- **改了什么**：patch `isLoopback` 认可 `__DSH_TRUSTED_LOOPBACK__` + index.html 注入该全局

- **为什么**：官方 isLoopback 只认 localhost/127.x；公网域名访问时 settings mirror 走 memory 模式，模型设置 tab 不可用

- **升级联动**：grep `__DSH_TRUSTED_LOOPBACK__` 于 conn client.js 与 index.html 两处

### B4. 技能目录「唤起即刷新」→ patches/02-skill-catalog-refresh.patch

- **改了什么**：patch `dsh-client-ui-skill/lib/client.js`：candidates 时先 `invalidate(session.sessionId)` 再 fetchCatalog

- **为什么**：官方按 session 缓存技能目录，新技能写入后已存在会话的 / 菜单仍是旧列表

- **升级联动**：grep `invalidate(session.sessionId); const skills = await fetchCatalog`

***

## C. 覆盖层（官方包整包替换 + 注入）——已退休

> 2026-09-12 fork：C 层整体退役。ui-workspace membership gate 已源码化于
> dsh-src `packages/client/ui-workspace/src/client/membership-gate.ts`（commit
> 594ff82e93），随 fork 构建产物进入镜像；`dsh-overrides/` 与
> `scripts/build-override-membership.mjs` 已删除。本节仅留历史档案。

### C1. membership gate（ui-workspace 项目权限裁剪）→ 已迁 fork 源码

- **曾改什么（历史）**：`dsh-overrides/dsh-client-ui-workspace-lib/` 覆盖官方 `dsh-client-ui-workspace` 同版本 lib；`scripts/build-override-membership.mjs` 注入 `__madaziRefresh/__madaziIsDeniedPath/__madaziGatedList/__madaziStartWatch`

- **为什么**：项目权限有三条泄漏通道（分组树 / Ungrouped 桶 / 本地搜索），官方无项目权限概念；在渲染源头 fail-closed 裁剪（fetch `/api/projects` 建成员表）

- **现在**：同一语义在 dsh-src 源码直接实现（`gatedWorkspaces`/`gatedList`/`isDeniedPath`/`startMembershipWatch`），接入点：tree.ts 三个 derive、SessionTree/WorkspacePickFlow（uSES 订阅）、navigation.ts（connect/reconcile/startSession）

- **升级联动**：UIWorkspace 包的行为随 fork 构建产物；升级重放合并 dsh-src 的 ui-workspace 改动（git merge 冲突即保险丝）

***

## D. host 插件（wb-src，零注入扩展点）

### D1. 会话引用归档过滤 + 权限过滤（session-ref-archive.ts）★本次

- **改了什么**：host 实例遮蔽 `sessionReferenceResolver.listCandidates`：① 剔除 `workspaceRegistry.archivedSessionIds`（归档）；② 按「发起会话活跃操作者权限根」过滤候选（复用 sandbox clamp 的 accessMap）

- **为什么**：@会话候选走官方 RPC 全量下发（listSessions 完整 corpus）：① 归档会话与列表层不通气仍出现；② candidates 不在网关 session/list 过滤拦截内，无权限项目会话全量泄露

- **升级联动**：见 ARCHITECTURE §11-11（proxy 侧 SESSION\_LIST\_RPC 含 candidates，双侧口径同步）

### D2. 沙箱跨项目权限钳制（sandbox-clamp.ts）★本次

- **改了什么**：host 遮蔽 `sandboxPolicy.resolve / sandbox.confine / ctx.fs.writeText|editText|resolve` 四个出口；权限根 = 会话活跃操作者的有权限项目（`/api/dsh/session-access-map`），SSE 推送变更

- **为什么**：官方 `danger-full-access` = 容器全盘读写，而 dsh-web 是共享单实例 → 一个用户能读写全部项目（多租户根本漏洞）。重定义 danger = 「可写活跃操作者有权限的所有项目」，无权限项目读写全拒，全链路 fail-closed

- **升级联动**：见 ARCHITECTURE §11-10；dsh 沙箱语义变化需重验 wrap 签名

### D3. 跨项目 @文件引用（23-cross-project-ref.js）★本次

- **改了什么**：客户端注册第二个 `@` 触发源（order 5，与官方源共存）；server `/api/projects/search-files` 按用户权限根过滤，候选按项目分组、绝对路径 mention

- **为什么**：官方 @文件只能引用当前工作区；需求是按用户权限跨项目引用

### D4. 内置浏览器 + AI 浏览器控制（browser-agent.ts + 22-browser-agent.js）

- **改了什么**：BrowserView iframe 挂活跃 tab；host 维护 activeTabs Map，AI 指令定向派发给发起会话窗口（takeoverBySession 隔离）；覆盖层跟随 + 鼠标可见但拦截点击

- **为什么**：多用户共享单实例，AI 浏览器控制必须定向到发起者窗口，其他人只读视图

### D5. 会话归属反写 + 发送人记录（server 侧权威）

- **改了什么**：dsh-web-proxy 在会话列表/发消息时按 cwd 反写 `dsh_session_owners`、记录 `dsh_message_senders`；客户端插件补充上报

- **为什么**：dsh 0.1.2 客户端模块级 fetch 绕过 window\.fetch 拦截，归属/发送人数据长期为 0 → 侧栏署名与权限解析失效

***

## E. 数据层

### E1. dsh\_session\_owners.active\_user\_id（活跃操作者）★本次

- **改了什么**：新增列；proxy 在会话 RPC（非 list）鉴权通过后更新 `active_user_id = me`；`session-access-map` 按 `COALESCE(active_user_id, user_id)` 计算权限根

- **为什么**：会话共享（项目级可见），按归属者发权限根会让 user2 借 admin 会话继承 admin 全部项目权限（实测越权）；谁操作按谁发权限

- **升级联动**：更新点（proxy）+ 计算点（dsh-meta.js）+ 消费点（sandbox-clamp accessMap）三处

### E2. 权限映射 SSE 推送（access-map-events.js）★本次

- **改了什么**：server 内存 EventEmitter 信号总线 + `/api/dsh/access-map/events` SSE 端点（25s 心跳）；变更点 bump（归属反写/session-owner/members 增删/admin 角色/活跃操作者）；dsh-web 订阅 + 指数退避重连

- **为什么**：用户反感轮询；权限撤销（移出项目/降级）必须秒级生效，轮询有窗口；事件驱动 + 断线全量重同步

- **升级联动**：新增任何权限变更点必须 bumpAccessMap()（见 ARCHITECTURE §11-10）

***

## F. 边界与红线（用户拍板，勿违反）

- **零注入**：集成 dsh 只走官方扩展点；弃 DOM hack

- **实时数据 WS 推送**（用户反感轮询；轮询仅兜底）

- **沙箱 fail-closed**：任何不确定 → 少权限，绝不放开（resolve catch / wrapWrite undefined / 幽灵路径全部收窄方向）

- **发布模板密钥扫描仅提示不阻断**（2026-09-03 用户拍板）

***

## G. 升级 dsh 重验清单（速查，2026-09-12 fork 版）

升级 = dsh-src merge 官方 tag + 本地构建 + build-dsh-web.sh 部署（完整 runbook 见
[docs/dsh-fork.md §5](dsh-fork.md)）。产物保险丝（3d 步骤 + Dockerfile grep）失配即停：

| 项 | 验证动作（产物 grep） | 源码位置 |
|---|---|---|
| membership gate | `api/projects` + `startMembershipWatch` + `gatedWorkspaces`（ui-workspace lib/client.js） | dsh-src ui-workspace `membership-gate.ts`（commit 594ff82e93） |
| loopback | `__DSH_TRUSTED_LOOPBACK__`（conn lib/client.js） | dsh-src connection `client/index.ts` |
| skill 刷新 | `invalidate(session.sessionId)`（ui-skill lib/client.js） | dsh-src ui-skill `client/index.ts` |
| trusted-host | 同 connection 包连坐（loopback 标记即覆盖生效）；`authorizeIndex(_request, _response)` 作二级指纹 | dsh-src connection `rpc-host.ts` |
| timeout | 确认官方默认 15e3（已无需处理） | — |
| workbench 插件 | 镜像内验证 5/5e/5b/5c/5d（build-dsh-web.sh） | scripts/build-dsh-web.sh |
| 模板版本 | `.madazi-template-version` 自增，initContainer 铺 PVC | profiles-web/ |

> 以上任一失配，Dockerfile/构建脚本都会显式失败并给出重适配提示——不会静默带病上线。

