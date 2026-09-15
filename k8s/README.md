# madazi K3s / Kubernetes 部署指南（现架构 2026-09-15）

> 适用于 K8s 云版：单节点 K3s 或云托管 K8s（ACK/TKE/EKS）均可。轻量部署请用「单机版」。

## 架构

```
公网/内网 ──▶ 入口网关（traefik，NodePort 30456，可选 frp 走公网域名）
                ├── /dsh-web/ + 数据面(RPC/WS) ──▶ madazi-dsh-web  (ClusterIP 3080)
                └── /api/* 平台 API + 登录门 ──▶ madazi-server   (ClusterIP 3456)
                                                     ├── PostgreSQL（PVC 持久化）
                                                     ├── Redis（跨副本事件总线，可选降级）
                                                     └── llm-gateway（模型代理+记账，NodePort 3459）
                  ┌── 项目预览 Pod（每个项目一个，preview-runtime 镜像，PVC 挂源码）
```

## 前置环境（部署前必须满足）

| 项 | 要求 | 作用 |
|---|---|---|
| Kubernetes | 单节点 K3s（`curl -sfL https://get.k3s.io | sh -`）或云托管集群 | 承载全部服务 |
| Docker | 本机构建机可用（构建镜像用） | 构建 server/preview/dsh-web 镜像 |
| Node.js ≥ 22 + pnpm | 构建机（仅重建 dsh-web 时需要） | `build-dsh-web.sh` 打包 workbench 插件 |
| 域名（可选）| 公网部署需解析到入口（演示可免） | traefik IngressRoute 按 Host 路由 |
| PVC | 集群默认 StorageClass（本机 k3s 用 local-path） | postgres/projects 持久化 |

## 镜像矩阵（现架构）

| 镜像 | 构建入口 | 说明 |
|---|---|---|
| `madazi-server:<tag>` | `madazi-server/Dockerfile` | 平台 API + 登录门 + 反代网关 |
| `madazi-dsh-web:latest` | `scripts/build-dsh-web.sh` | 工作台一键构建（pack→profiles→import→rollout→PVC 版本）|
| `madazi-preview-runtime` | `preview-runtime/Dockerfile`（node/spring 变体按需）| 项目预览运行时 |
| `madazi-llm-gateway:g01` | 复用具构建产物 | 模型网关（无改动不重建）|
| `postgres:16` / `redis:7` / `traefik` | 官方镜像 | 数据面/入口 |

## 部署步骤（本机 colima-K3s / 单节点）

```bash
# 0) 前置：docker 与 k3s 可用（本机 colima 或 REMOTE=user@host 远程）

# 1) 构建并导入镜像（server → 新 tag 自动带日期，铁律：换镜像用新 tag）
./deploy-k3s.sh all          # server 构建+导入+apply 全部清单+等待+verify
#   或分开执行：
#   ./deploy-k3s.sh server    # 只升 server
#   ./deploy-k3s.sh preview   # 只重建 preview-runtime
#   ⚠ dsh-web 镜像更新单独执行（成体系流程）：
bash scripts/build-dsh-web.sh # wb-src pack → profiles → docker build → ctr 导入 → rollout → PVC 模板版本

# 2) 查看状态 / 探活
./deploy-k3s.sh status
./deploy-k3s.sh verify       # 网络层入口可达 + 应用层 /api/health + 登录页（VERIFY_URL 可配）

# 3) 访问入口
#    公网有域名：https://<your-domain>/dsh-web/ ，默认账号 admin/admin123（首次自动创建，请立即修改）
#    本机无域名：traefik NodePort http://NodeIP:30456（404 属预期，域名路由需 Host 匹配）
```

> 手动等价流程（不依赖脚本）：
> 1. `docker build -t madazi-server:<tag> madazi-server/`
> 2. `docker save madazi-server:<tag> | sudo k3s ctr -n k8s.io images import -`（★ 必须 `-n k8s.io`，否则 pod ErrImageNeverPull 静默用旧镜像）
> 3. `kubectl apply -f k8s/`（namespace→configmap→secret→pvc→数据面→服务面）
> 4. `kubectl -n madazi rollout status deployment/madazi-server`

## 配置项

`k8s/configmap.yaml`（非敏感）：
- `PREVIEW_DOMAIN`：预览子域父域（pv-<id>.<domain>），内置默认 `<YOUR-DOMAIN>.com`，请改为你的域名
- `PROJECTS_ROOT` / `DSH_HOME`：`/app/generated` / `/app/generated/.dsh`（与 dsh-web 同 PVC 根，一般不动）
- `REDIS_URL`：跨副本事件总线（未配置自动降级单副本）

`k8s/secret.yaml`（敏感，部署前必填）：
- `JWT_SECRET`：平台登录 JWT 密钥（改）
- `POSTGRES_PASSWORD`：数据库口令（改，与 `postgres-deployment.yaml` 的 POSTGRES_PASSWORD 一致）
- 数据库连接串由 server 容器 env 组装（见 `server-deployment.yaml` 的 DATABASE_URL）

改 configmap/secret 后必须 `kubectl -n madazi rollout restart deployment/madazi-server` 等。

## 云托管 K8s（ACK/TKE/EKS）

构建机推镜像到仓库，集群直接拉取（无需 ctr 导入）：

```bash
docker tag madazi-server:<tag> registry.example.com/ns/madazi-server:<tag>
docker push registry.example.com/ns/madazi-server:<tag>
# 将 k8s/*.yaml 的 image 改为仓库地址 + 设置 imagePullSecrets（若私有仓）
kubectl apply -f k8s/
```

云集群需自带 StorageClass（或手动建 PV）；traefik IngressRoute 通过云负载均衡器暴露。

## 验证清单（部署是否成功）

1. `kubectl -n madazi get pods`：server/dsh-web/llm-gateway/postgres/redis 均 `Running 1/1`（dsh-web 为 2/2）
2. `curl https://<domain>/api/health` → `200`
3. 打开 `https://<domain>/dsh-web/` 登录页可渲染，`admin/admin123` 可登录进工作台
4. 建项目 → 启动预览 → pv-<id>.<domain> 预览可访问

## 故障排查

- **Pod Pending / ErrImageNeverPull**：镜像没进 k3s（ctr 导入漏了 `-n k8s.io`）或 tag 不存在。`sudo k3s ctr -n k8s.io images ls | grep madazi` 核对；重导入后需 `rollout restart`（kubelet 退避不会自动重试）
- **Pod CrashLoopBackOff**：`kubectl -n madazi logs <pod> --previous` 看崩溃原因；常见为 secret 未配（DB 口令/JWT）或 DATABASE_URL 指向不对
- **改了 configmap/secret 不生效**：必须 `rollout restart`（env 注入不热更新）
- **入口 404**：域名未匹配 traefik IngressRoute——确认访问用域名（Host 头），裸 IP 403/404 属预期
- **server 起来但登录页连不上 WS**：确认 frp/NodePort 把 30456（traefik 80）与后续 WS upgrade 透传；`/api/remote.*` 与 `/api/events.*` 必须由 dsh-web 反代（server 已内置，无需另配）
- **磁盘涨满**：docker 构建垃圾触发 kubelet 镜像 GC 会误删 preview 镜像——`docker system prune` 保底，留足 /dev/vdb1 空间

## 资源估算（单节点，小团队）

| 组件 | 内存/CPU 参考 |
|---|---|
| madazi-server | 384Mi / 300m |
| madazi-dsh-web | 256Mi / 200m |
| madazi-llm-gateway | 256Mi / 200m |
| madazi-postgres | 512Mi / 300m |
| preview（每项目） | 256Mi / 200m |
| **合计基准** | ≥ 4Gi 内存 / 2 核 |

> 详细部署链路（frp/traefik/IngressRoute/WS 全景）见 `docs/ARCHITECTURE.md`。