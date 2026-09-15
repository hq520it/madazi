# madazi Helm Chart

一个 chart 覆盖两种交付：**云厂商 k8s（EKS/ACK/AKS）** 与 **裸机 k3s**。

## 资源清单

| 组件 | 资源 | 说明 |
|---|---|---|
| traefik | Deployment + Service(入口 NodePort) + CRD + IngressRoute + Middleware | 入口网关（P3）：dsh 分流/登录门/特权 RPC 伪装，server 发版不断 dsh WS |
| madazi-server | Deployment + Service(ClusterIP) | 平台 API + forwardAuth 探针（RBAC 授权动态管 pod） |
| madazi-dsh-web | Deployment(2 容器) + ConfigMap + Service | 官方 DSH Web 工作台（**replicas 必须为 1**） |
| madazi-llm-gateway | Deployment + Service(NodePort) | LLM 计费网关（模型腿直连入口） |
| madazi-postgres | Deployment + Service + PVC | 平台数据库 |
| madazi-redis | Deployment + Service | 事件总线（纯内存，P1a） |
| madazi-preview | StatefulSet + headless Service | 预览预热池（replicas 0 = 关闭） |

## 快速部署

### 裸机 k3s（推荐起点）

```bash
# 1. 装 k3s（30s）
curl -sfL https://get.k3s.io | sh -

# 2. 导入镜像（本地构建场景；或推到 registry 后走 image.registry 参数）
docker save madazi-server:latest madazi-dsh-web:latest madazi-dsh:latest \
  madazi-preview-runtime:latest madazi-llm-gateway:latest traefik:v3.5 \
  | sudo k3s ctr -n k8s.io images import -

# 3. 写 my.yaml（拷 values.yaml 改 domain/previewDomain/secrets 三处必改）

# 4. 安装
helm install madazi deploy/helm/madazi -n madazi --create-namespace -f my.yaml
```

### 云厂商 k8s

```bash
# my.yaml 关键覆盖：
#   domain: madazi.customer.com
#   previewDomain: customer.com
#   image: { registry: "registry.example.com/madazi", pullSecrets: [{name: regcred}] }
#   storage: { className: "customer-sc" }     # 按需；留空 = 集群默认
#   service: { type: ClusterIP }               # 配合自有 Ingress/LB；NodePort 也行
#   secrets: { jwtSecret/postgresPassword/keyMasterSecret/svcToken 全改 }
helm install madazi deploy/helm/madazi -n madazi --create-namespace -f my.yaml
```

## 参数速查（values.yaml）

| 键 | 默认 | 说明 |
|---|---|---|
| `domain` | madazi.example.com | **必改**：dsh-web --trusted-host 白名单 |
| `previewDomain` | example.com | **必改**：预览子域父域 pv-\<id\>.\<previewDomain\> |
| `image.registry` | "" | 空 = 本地镜像；填 registry 前缀走拉取 |
| `image.pullPolicy` | IfNotPresent | 本地导入场景用 `Never` |
| `secrets.existingSecret` | "" | 非空 = 复用已有 Secret（不创建） |
| `storage.className` | "" | 空 = 集群默认 SC（k3s = local-path） |
| `service.type` | NodePort | NodePort / ClusterIP（云 Ingress 场景） |
| `traefik.enabled` | true | 入口网关开关（false = 旧拓扑 server 直暴 NodePort） |
| `traefik.image` | traefik:v3.5 | 本地导入场景需含在 docker save 清单 |
| `dshWeb.replicas` | 1 | **铁律必须 1**（单进程会话所有权） |
| `server.replicas` | 1 | 可 >1（P1a 总线已支持多副本） |
| `previewPool.replicas` | 0 | 预览预热池大小 |

## 开发环境（colima）

```bash
helm template madazi deploy/helm/madazi -f deploy/helm/madazi/values-colima.yaml
# values-colima.yaml 复刻本机集群：Never + local-path + existingSecret + NodePort
```

## 客户环境交付：清理业务数据

新装环境本身干净（helm install 后无业务数据）。本步骤用于**复用既有存储 / 迁移场景**：
从开发/测试环境导出（PV 数据一起搬）部署到客户前，清掉开发期业务数据，保证客户拿到干净环境。
若 PV 是全新初始化（客户首次安装），跳过本步骤。

### 保留 / 清空清单（⚠️ 关键）

| 数据 | 处理 | 说明 |
|---|---|---|
| `users`（除 admin） | **清空** | 保留 admin 供初始管理（密码客户侧改） |
| `projects` / `conversations` / `conversation_messages` / `project_members` / `generations` | **清空** | 测试项目与会话 |
| `skills` / `templates` / `template_versions` / `template_ratings` | **清空** | 用户发布内容；官方内置在 server 启动时自动重建 |
| `api_keys` | **🔴 保留！** | BYOK 登录链路凭据。删除会导致 dsh 发消息报 `API key is invalid`（gateway 校验 DB key_hash 失败）——本仓库踩过 |
| `usage_logs` / `user_quotas` / `user_oauth_accounts` / `dsh_session_owners` / `dsh_message_senders` | **清空** | 计费 / 配额 / 三方绑定 / 会话归属 |
| `invite_codes` | **重置** | `used_by=NULL, used_at=NULL`（保留码本身） |
| `settings` / `licenses` / `model_costs` / `llm_configs` | **保留** | 系统配置与许可证，勿动 |
| PVC：`/app/generated/<uuid>*/` 项目目录、`/app/generated/.dsh/sessions/`、`/app/generated/_uploads/`、`/app/generated/.market-packages/` | **清空** | 项目文件 / 会话 / 上传 / 模板包 |
| PVC：`.pnpm-store` / `.npm-cache` / `.m2-repo`、`.dsh/profiles`、`pgdata` | **保留** | 共享缓存（加速构建）+ 插件树 + 数据库 |

### 步骤

**1) 查 admin 用户 id（保留它）**
```bash
kubectl -n madazi exec deploy/madazi-server -- node -e \
  'const pg=require("pg");const p=new pg.Pool({connectionString:process.env.DATABASE_URL});\
   p.query("SELECT id,username,role FROM users WHERE role='\''admin'\''").then(r=>{console.log(r.rows);process.exit(0)})'
```

**2) 清 DB 业务表**（`kubectl -n madazi exec deploy/madazi-server -- node -e '...'`，事务内执行，`ADMIN_ID` 替换）：
```sql
BEGIN;
DELETE FROM project_members;
DELETE FROM conversation_messages;
DELETE FROM conversations;
DELETE FROM generations;
DELETE FROM usage_logs;
DELETE FROM user_quotas;
DELETE FROM user_oauth_accounts;
DELETE FROM dsh_message_senders;
DELETE FROM dsh_session_owners;
DELETE FROM template_ratings;
DELETE FROM template_versions;
DELETE FROM templates;
DELETE FROM skills;
DELETE FROM api_keys WHERE user_id <> 'ADMIN_ID';  -- ⚠️ 只清其他用户的 key，本机 admin 的 key 必须保留
DELETE FROM projects;
DELETE FROM users WHERE id <> 'ADMIN_ID';
UPDATE invite_codes SET used_by = NULL, used_at = NULL;
COMMIT;
```

**3) 清 PVC 项目数据**（`kubectl -n madazi exec deploy/madazi-dsh-web --`）：
```bash
cd /app/generated
find . -maxdepth 1 -type d \( -regex '\./[0-9a-f]\{8\}-[0-9a-f-]\{27\}' -o -name '*-wt-*' \) -exec rm -rf {} +
rm -rf _uploads/* .market-packages/* .dsh/sessions/* .dsh/storages/session_projcache.json
```
> ⚠️ 若项目目录内含 `pgdata` 子目录删不掉（预览 pod 的 postgres 数据，Permission denied）：
> 先 `kubectl -n madazi delete pod <madazi-preview-*> --grace-period=0 --force` 停孤儿预览 pod，
> 再从 **宿主层**（local-path PV 路径 `kubectl get pv <projects-pvc-pv> -o jsonpath='{.spec.local.path}'`）`sudo rm -rf`。

**4) 重启 server 重建官方模板**（启动时 `syncOfficialTemplates` 自动注册 6 个内置模板）：
```bash
kubectl -n madazi rollout restart deployment/madazi-server
kubectl -n madazi rollout status deployment/madazi-server --timeout=150s
```

**5) 重建种子技能**（从 anthropics/skills 提取 6 个 + 代码审查，需本地 `/tmp/anthropics-skills`）：
```bash
node scripts/extract-skills.cjs && node scripts/add-seed-skills.cjs   # 用 admin 登录发布（默认 admin/admin123）
```

**6) 清理 dsh 侧 BYOK key 残留（仅当曾误删 api_keys 时）**
若第 2 步**保留**了 admin 的 key 则跳过。误删后：清掉 dsh settings.yaml 里 `llm-pi-ai.providers` 的 `madazi-u-*` 段 + `agent-default-model.provider` 指向（已删用户），重启 dsh-web，**admin 重新登录**触发重签注入。

**7) 验证**：`/api/health` 200；admin 登录后项目列表为空、官方模板 6 个、种子技能 7 个；新建项目发消息正常（无 `API key is invalid`）。

## mz-key（BYOK 用户 key）管理

**背景**：`mz-` 前缀 key 是平台对话链路的**用户认证凭据**——dsh 发消息带它过 llm-gateway，gateway 查 `api_keys` 表确认"谁在调用"并按用户记账。用户登录时 login 插件**自动签发**（`POST /api/keys/provision`，轮换制），正常路径无需人工干预。需要人工管理仅在这些场景：key 泄露需轮换、用户计费异常排查、交付审计。

**前提**：先拿 admin token（平台登录接口签发，与用户登录同一 JWT）：
```bash
TOKEN=$(curl -s -X POST https://<domain>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<admin密码>"}' | jq -r .token)
```

**1) 查看 key**（列表只含 `key_prefix` 前 10 位 + 状态，不含明文）：
```bash
curl -s -H "Authorization: Bearer $TOKEN" 'https://<domain>/api/keys?userId=<uid>'   # 指定用户
curl -s -H "Authorization: Bearer $TOKEN" 'https://<domain>/api/keys/all'             # 全部用户
```

**2) 签发（手动）**——明文**只在此次响应返回一次**，DB 只存 hash，务必立即保存：
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"userId":"<uid>","name":"manual"}' https://<domain>/api/keys
# admin 可代任意用户签（body 带 userId）；普通用户不带 userId 签自己的。每用户最多 5 把活跃 key。
```

**3) 轮换**——两种方式：
- **用户自己轮换（推荐）**：该用户登录后调 `POST /api/keys/provision`（吊销其全部活跃 key + 签发新 key），随后**重新登录**让 login 插件把新 key 注入 dsh（幂等判断对"未配置"才重签，旧 key 已 revoke 需重登触发）。
- **admin 代轮换**：`POST /api/keys`（带 userId）签发新 key → `DELETE /api/keys/<旧key_id>` 吊销旧 key → 通知该用户重新登录刷新 dsh 侧配置。

**4) 吊销**（key 泄露 / 停用用户）：
```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" https://<domain>/api/keys/<key_id>
```
> 吊销后该用户对话立即 `API key is invalid`；用户重新登录即自动签发新 key 恢复。

**轮换注意**：provision 是"吊销全部活跃 + 签新"的轮换制；手动轮换后**必须让对应用户重新登录**（dsh 侧 `settings.yaml` 的 `apiKeyEnv` 引用需要 login 插件重签注入，单纯替换 DB 不生效）。

## 注意事项

1. **存储拓扑**：projects PVC 挂载方（server/dsh-web/preview pool/动态任务 pod）在
   local-path SC 下天然钉在首节点（节点亲和）——多节点集群即"数据面单节点 + 无状态面漂移"
   标准拓扑，**勿换网络存储 SC**（inotify/SQLite/硬链接三杀手，见 ARCHITECTURE.md §2.8）
2. **三表同步铁律**：`templates/traefik.yaml` 的 IngressRoute 平台 API 正则、
   `templates/dsh-web.yaml` 的 nginx 白名单正则、
   `madazi-server/src/services/dsh-web-proxy.js` 的 `PLATFORM_API` 必须**镜像同步**——
   改一处必改另两处，否则 404 或 server↔pod 环路
3. **入口链路**（traefik.enabled 时）：公网 frp/LB → traefik NodePort(30456) →
   IngressRoute 分流（平台 API → server；dsh RPC/事件流 → dsh-web）；
   反代层须放行 `/api/`、`/dsh-web/`、`/plugins/`、`/git/`、`/workbench-sounds/`、`/ultra-slash/` 前缀
4. **升级**：`helm upgrade madazi deploy/helm/madazi -f my.yaml`（镜像换 tag 即滚动更新）
