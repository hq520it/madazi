# dsh 内核全面 fork 方案（改源码，本地构建打包）

> 决策（2026-09-12，用户拍板）：把 DeepSeek Harness 内核从「npm 包 + 运行期补丁」改为
> 「自维护源码 fork + 本地构建」，与 wb-src 同一模式。每次升级 = 拉官方最新 → 重放 patch →
> 本地构建 dsh 包 → 构建 Docker 部署验证 → 上传 patch 后的源码。
> 收益：diff 可读（改源码手感）、可灵活打多形态包（含单机版）。

---

## 1. 目标形态

```
madazi 镜像构建链（改造后）
├── dsh-src/     ← 官方 deepseek-harness 源码 fork（独立 git 仓，嵌套在本仓库，wb-src 同模式）
│      ├── 官方 tag 基线（锁版本）
│      └── madazi patches（3 处内核修改直接落在源码上，git 历史可见）
├── wb-src/      ← 前端 fork（不变，已独立）
└── Dockerfile.dsh-web 改造：
     FROM node:24 → COPY dsh-src → 本地构建 dsh 全局产物（替代 npm i -g dsh）
```

## 2. 目录与仓库布局

| 项 | 位置 | 说明 |
|---|---|---|
| fork 工作树 | `dsh-src/`（本仓库根下嵌套，与 wb-src 同模式） | 独立 git 仓库（.git 保留），远端 `fork` = hq520it/dsh-fork、`upstream` = 官方；根 .gitignore `dsh-src/` 不入主仓；开源投放随 publish-opensource.sh 进公开副本 |
| 补丁落点 | dsh-src 内**直接改源码**（提交即记录） | 不再用 node -e 字符串替换 |
| 覆盖层去向 | 官方覆盖的 3 个包（connection/skill/ui-workspace）**全部进 fork 源码改** | dsh-overrides 作为独立覆盖包退役 |
| 镜像集成 | `COPY dsh-src/ /dsh-src` + 构建 RUN | 产物替代 `npm i -g` |

## 3. 构建链

```bash
# 一次性起步
git clone --depth 1 --branch dsh-v0.1.5-rc.1 https://github.com/deepseek-ai/deepseek-harness dsh-src
cd dsh-src && pnpm install --frozen-lockfile
# 应用 3 处内核 patch（源码级，git commit 记录）
git apply /path/to/patches/*.patch        # 01-loopback / 02-skill / 03-trusted-host
git commit -m "madazi: 内核三处定制(browserAuth/isLoopback/skill-refresh)"

# 每次修改后本地构建（对 wb-src，同款）：
pnpm build
# 产物 → Docker 基础层（替代全局 npm 包）：
docker build -f Dockerfile.dsh-web .      # COPY dsh-src 后 RUN node <构建脚本> 产出全局树
```

## 4. 现有要素的迁移映射

| 现状 | fork 后 | 动作 |
|---|---|---|
| Dockerfile Step2 `npm i -g @deepseek-ai/dsh@0.1.5-rc.1` | `COPY dsh-src` + 本地构建产出此全局树 | 删除 npm 安装，改为构建产物 |
| evil Step7 loopback（node -e） | dsh-src 源码直接改 isLoopback 判定 + index.html | 删除该 RUN |
| Step8 skill 刷新（node -e） | dsh-src 源码直接改 candidates | 删除该 RUN |
| Step13 trusted-host（node -e） | dsh-src 源码直接改 browserAuth 两处 | 删除该 RUN |
| Step9~12 覆盖层 COPY + 断言 | ✅ 已退役（2026-09-12）：membership gate 迁入 fork 源码（commit 594ff82e93），dsh-overrides/ 与注入脚本已删除 | 已完成 |
| patches/ 文档 | patches/ 四个源码布局 git patch（01-03 内核 + 04 gate，`git apply --check` 重放） | 已完成 |
| scripts/build-dsh-web.sh | 3d 同步三包产物（connection/ui-skill/ui-workspace）+ 保险丝；5/5e/5b/5c/5d 镜像内验证 | 已完成 |

## 5. 升级 runbook（fork 后，2026-09-12 现状）

> 定制现状（升级时的冲突/验证焦点）：
> - **connection**（2 commit）：`rpc-host.ts`（trusted-host 直通）+ `client/index.ts`（loopback 标记）→ 产物保险丝 grep `__DSH_TRUSTED_LOOPBACK__`
> - **ui-skill**：`client/index.ts` candidates `invalidate` → grep `invalidate(session.sessionId)`
> - **ui-workspace**（gate commit 594ff82e93）：新增 `membership-gate.ts` + 改 tree/WorkspaceBrowser/WorkspacePicker/navigation → grep `api/projects`+`startMembershipWatch`+`gatedWorkspaces`

```bash
# 0. 前置：确认本地 dsh-src 干净、fork 远端与 upstream 都在
cd dsh-src && git status --porcelain && git remote -v
git fetch upstream && git fetch fork

# 1. 合并官方新 tag（保留 madazi 定制 commit 历史；若采用 patch 重放模式则跳过此步）
git merge upstream/dsh-v<新tag>            # 冲突集中在定制文件（连接 2、ui-skill 1、ui-workspace 5），逐个解
# git apply 校验（无论 merge 还是重放模式都要过；patches/01-04 全部）：
git apply --check $HOME/code/madazi/madazi-server/docker/acp/patches/*.patch
# 冲突处理通则：madazi 定制 == 语义覆盖官方默认，合并取舍按「定制意图」保留

# 2. 构建 + 产物保险丝
pnpm install && pnpm build                # 全量（native/lib/web）
# 保险丝 = build-dsh-web.sh 3d 内置的产物 grep（loopback/skill/gate 标记），
# 失配即停，等价旧版「升级重验锚点」。若官方产物形态变化导致标记消失：
#   先判官方是否已内置同语义 → 删除对应定制；否则改源码标记并同步 patch/文档。

# 3. 部署 + 验证
bash scripts/build-dsh-web.sh             # 3d 同步产物 → docker build → 5/5e/5b/5c/5d → rollout → 线上 200
```

**升级后冒烟清单**（每一项都必须过，映射 CUSTOMIZATIONS.md G 表）：
1. 工作台入口 HTTP 200；登录后侧栏只显示我的项目（gate fail-closed）
2. / 菜单技能目录含最新技能（skill 刷新）
3. 设置 → 模型 tab 可用（loopback）
4. 无权限项目：搜索/侧栏/连接任一入口都进不去（3 通道 gate）
5. 多人会话/终端/文件树正常（内存/协议未漂移）

**回滚预案**（部署失败时）：
- 镜像层：构建前 `docker tag madazi-dsh-web:latest madazi-dsh-web:pre-<tag>-$(date +%m%d)` 留底；失败则 `docker save` 旧镜像 → ctr 导入 → rollout restart
- 快速回退：`kubectl -n madazi rollout undo deployment/madazi-dsh-web`（回到上一 replica set）
- 数据面不受影响：server 与 PVC 不随 dsh-web 升级回滚

**升级节奏**：官方 ~2 周/rc，跟随官方 stable/`latest` 稳定线；小版本升级走同一 runbook；官方 breaking 变更（Cordis/插件协议/会话格式）优先评估再动。

## 6. 多形态打包（fork 的红利）

同一 dsh-src 可产出多形态：
- **云版**：现有 madazi-dsh-web 镜像（rollout 部署）
- **单机版**：dsh-src 构建产物 + server 单进程包 → 离线 tar 安装包（无 k3s/traefik）
- **Docker Compose 版**：server/dsh-web/PG 三容器 compose（此前评估过的形态 B）

## 7. 风险与缓释

| 风险 | 缓释 |
|---|---|
| 依赖树构建链维护（tsdown/pnpm 版本、node ABI） | 与 wb-src 同工具链已验证；锁 pnpm 版本 |
| 官方升级频繁（~2 周/rc） | merge 冲突集中于 2-3 个 commit，比整仓定制小得多 |
| fork 变"发行版"的长期跟随成本 | 明确只 patch 3 处 + 覆盖包，禁止随意改内核 |
| 镜像体积/构建时长 | dsh-src 构建产物层缓存策略（与 profiles-web 相同思路） |

## 8. 起步清单（第一步）

- [x] clone 官方 repo（tag dsh-v0.1.5-rc.1）到本仓库 `dsh-src/`（完整历史，已推送远端 hq520it/dsh-fork）
- [x] 建 fork 远端（GitHub 公开，hq520it/dsh-fork）+ 推送完整历史
- [x] 迁移 3 处补丁到源码 + 提交并推送（a8b829d760 + 0a83ff3222 编译修复）
- [x] patches/ 四文件重写/新增为**源码布局标准 git patch**（01-03 内核 + 04 gate；`git apply --check` 全过，clean-room 应用后与 fork 树逐字节一致）
- [x] 本地构建产物验证（pnpm install + pnpm build 全链通过，234 client artifacts；发现 TS6133 未用参数并修复）
- [x] 改造 Dockerfile.dsh-web（npm i -g 降级为承载体 + `dsh-src-dist` 产物覆盖 connection/ui-skill 两包），三个运行期补丁 RUN 全部退役
- [x] 覆盖层（ui-workspace membership gate）迁入 fork 源码（commit 594ff82e93），dsh-overrides/ 与 build-override-membership.mjs 退役删除
- [x] 全链构建 + 部署验证（2026-09-12 完成：5/5e/5b/5c/5d 全过 + rollout 200 + pod 内 loopback/trusted-host/skill/gate 在线实证）
- [ ] 同步 GitHub 开源仓库（源码已在线更新，重跑 publish-opensource 后 push）

> 2026-09-12 教训：tsdown 产物压缩后**注释级标记消失**（`__DSH_TRUSTED_LOOPBACK__`、`invalidate(session.sessionId)` 为代码标记得以保留；`madazi trusted-host bypass` 注释被剥离）。保险丝改用代码级标记；trusted-host 与 loopback 同包连坐验证（见 Dockerfile 注释）。压缩产物中 `authorizeIndex(_request, _response)` 签名可作 secondary 指纹。