#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# madazi K8s 远程一键部署脚本
# 目标：把 madazi 全栈部署到一台全新的 Linux 服务器（K3s）
#
# 用法:
#   ./deploy-k8s-remote.sh <user@host>              # 全流程（装K3s→构建→导镜像→apply→验证）
#   ./deploy-k8s-remote.sh <user@host> k3s          # 只装 K3s + 国内 mirror
#   ./deploy-k8s-remote.sh <user@host> images       # 只构建+导入镜像
#   ./deploy-k8s-remote.sh <user@host> apply        # 只下发 YAML（含 secret/configmap 定制）
#   ./deploy-k8s-remote.sh <user@host> verify       # 只验证
#   ./deploy-k8s-remote.sh <user@host> status       # 看 Pod/Service 状态
#
# 可选环境变量:
#   PREVIEW_DOMAIN=xxx.example.com   预览泛域名（默认 <YOUR-DOMAIN>）
#   POSTGRES_PASSWORD=xxx            数据库密码（默认 CHANGE-ME-POSTGRES-PASSWORD）
#   SKIP_BUILD=1                     跳过本地构建（镜像已构建好时）
#   IMPORT_POSTGRES=1                顺带导入 postgres:16-alpine（默认由 K3s 从 mirror 自动拉）
#
# 依赖: 本机能 ssh 到目标机、本机 docker（macOS 为 colima）、目标机有 root/sudo
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

REMOTE="${1:?用法: $0 <user@host> [k3s|images|apply|verify|status|all]}"
PHASE="${2:-all}"
NS="madazi"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
K8S_DIR="$PROJECT_ROOT/k8s"
AC_IMAGE_MIRROR="https://docker.1ms.run"   # docker.io 加速 mirror

PREVIEW_DOMAIN="${PREVIEW_DOMAIN:-<YOUR-DOMAIN>}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-CHANGE-ME-POSTGRES-PASSWORD}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $1"; }

R() { ssh "$REMOTE" "$@"; }                                    # 远程命令
K() { R "sudo k3s kubectl -n $NS $*"; }                        # 远程 kubectl

# ────────────────────── 0. 前置检查 ──────────────────────
check_local() {
  command -v docker >/dev/null 2>&1 || { log_err "本机未安装 docker"; exit 1; }
  # macOS: 默认用 colima (profile: madazi) 的 docker
  if [ "$(uname -s)" = "Darwin" ] && [ -S "$HOME/.colima/madazi/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.colima/madazi/docker.sock"
    log_ok "macOS: DOCKER_HOST=$DOCKER_HOST (colima)"
  fi
  docker info >/dev/null 2>&1 || { log_err "docker 不可用（daemon 未启动?）"; exit 1; }
  [ -f "$K8S_DIR/namespace.yaml" ] || { log_err "找不到 $K8S_DIR，请在仓库根目录运行"; exit 1; }
}

check_remote() {
  log_info "检查 SSH 连通: $REMOTE ..."
  R "uname -m" >/dev/null || { log_err "SSH 不通"; exit 1; }
  R "sudo -n true" >/dev/null 2>&1 || { log_err "目标机 sudo 需要密码，请配置免密 sudo"; exit 1; }
  REMOTE_ARCH="$(R 'uname -m')"
  log_ok "远程架构: $REMOTE_ARCH"
}

# ────────────────────── 1. 安装 K3s ──────────────────────
install_k3s() {
  if R "command -v k3s" >/dev/null 2>&1; then
    log_ok "K3s 已安装: $(R 'k3s --version | head -1')"
    return
  fi
  log_info "安装 K3s（国内 mirror，禁用 traefik）..."
  R "curl -sfL https://rancher-mirror.rancher.cn/k3s/k3s-install.sh | INSTALL_K3S_MIRROR=cn sh -s - --disable traefik" \
    || { log_err "K3s 安装失败"; exit 1; }
  log_ok "K3s 安装完成"
  # docker.io mirror（拉 postgres 等公共镜像走国内加速）
  R "sudo mkdir -p /etc/rancher/k3s && printf 'mirrors:\n  docker.io:\n    endpoint:\n      - $AC_IMAGE_MIRROR\n' | sudo tee /etc/rancher/k3s/registries.yaml >/dev/null && sudo systemctl restart k3s"
  log_ok "registries.yaml 已配置 (docker.io -> $AC_IMAGE_MIRROR)"
  log_info "等待 K3s node Ready ..."
  R "sudo k3s kubectl wait --for=condition=ready node --all --timeout=300s"
}

# ────────────────────── 2. 构建镜像 ──────────────────────
build_images() {
  local arch="$1" build_flag=""
  # 跨架构检查：本机 docker 架构 vs 目标机架构
  local local_arch
  local_arch="$(docker info --format '{{.Architecture}}' 2>/dev/null || echo unknown)"
  if [ "$local_arch" != "$arch" ]; then
    log_warn "本机 docker 架构=$local_arch，目标机=$arch，尝试 buildx 跨架构构建..."
    local plat; case "$arch" in x86_64) plat=amd64 ;; aarch64) plat=arm64 ;; *) plat="$arch" ;; esac
    build_flag="--platform linux/$plat"
    docker buildx version >/dev/null 2>&1 || { log_err "需要 buildx（跨架构构建）"; exit 1; }
  fi

  # dsh-agent 二进制架构强校验（pkg 打包产物，不匹配必须重新打包）
  local agent_arch
  agent_arch="$(file -b "$PROJECT_ROOT/madazi-server/docker/acp/dsh-agent" 2>/dev/null || echo unknown)"
  case "$arch" in
    x86_64)  echo "$agent_arch" | grep -qi "x86-64" || { log_err "dsh-agent 是 $agent_arch，目标机需要 x86-64。请用 dsh-build 流程重新打包 exe"; exit 1; } ;;
    aarch64) echo "$agent_arch" | grep -qi "aarch64\|ARM aarch64" || { log_err "dsh-agent 是 $agent_arch，目标机需要 aarch64。请用 dsh-build 流程重新打包 exe"; exit 1; } ;;
  esac

  log_info "构建全部镜像（依赖顺序: server, preview-node→spring, dsh）..."
  ( cd "$PROJECT_ROOT/madazi-server"          && docker build $build_flag -t madazi-server:latest . )

  ( cd "$PROJECT_ROOT/madazi-web"             && docker build $build_flag -t madazi-web:latest . )
  ( cd "$PROJECT_ROOT/preview-runtime"        && docker build $build_flag -f Dockerfile.node -t madazi-preview-node:latest . )
  ( cd "$PROJECT_ROOT/preview-runtime"        && docker build $build_flag -f Dockerfile.spring -t madazi-preview-spring:latest . )
  ( cd "$PROJECT_ROOT/preview-runtime"        && docker build $build_flag -t madazi-preview-runtime:latest . )
  ( cd "$PROJECT_ROOT/madazi-server/docker/acp" && docker build $build_flag -t madazi-dsh:latest . )
  log_ok "6 个镜像构建完成"
}

import_images() {
  local imgs=(madazi-server madazi-web madazi-preview-node madazi-preview-spring madazi-preview-runtime madazi-dsh)
  [ "${IMPORT_POSTGRES:-0}" = "1" ] && imgs+=(postgres:16-alpine)
  log_info "docker save | ssh ctr import（约 5GB，视带宽可能数分钟）..."
  # ★ 必须带 -n k8s.io：不带 namespace 导入会落到 containerd default 命名空间，k3s Pod 看不到
  docker save "${imgs[@]/%/:latest}" | R "sudo k3s ctr -n k8s.io images import -" \
    || { log_err "镜像导入失败"; exit 1; }
  log_ok "镜像导入完成: $(R 'sudo k3s ctr -n k8s.io images ls | grep -c madazi') 个 madazi 镜像"
}

# ────────────────────── 3. 下发 YAML ──────────────────────
apply_yamls() {
  log_info "同步 YAML 到远程 ~/madazi-k8s/ ..."
  R "mkdir -p ~/madazi-k8s"
  scp -q "$K8S_DIR"/*.yaml "$REMOTE:~/madazi-k8s/"

  # 3.1 namespace 先行
  K apply -f ~/madazi-k8s/namespace.yaml --wait=true >/dev/null

  # 3.2 完整 secret（仓库 yaml 只存 2 个 key 防泄密，这里补齐 server 必需的 7 个）
  #    ★ 幂等：已存在则跳过（重跑不会换 KEY_MASTER_SECRET 导致已加密的 LLM API Key 失效）
  if K get secret madazi-secret >/dev/null 2>&1 && [ "${FORCE_SECRET:-0}" != "1" ]; then
    log_ok "secret 已存在，跳过（如需重置: FORCE_SECRET=1）"
  else
    local jwt km
    jwt="$(openssl rand -hex 24)"
    km="$(openssl rand -hex 32)"   # 32字节 hex，LLM API Key 加解密主密钥
    R "sudo k3s kubectl -n $NS create secret generic madazi-secret \
        --from-literal=JWT_SECRET='$jwt' \
        --from-literal=POSTGRES_PASSWORD='$POSTGRES_PASSWORD' \
        --from-literal=KEY_MASTER_SECRET='$km' \
        --from-literal=DSH_EXE_PATH='/app/scripts/dsh-run.sh' \
        --from-literal=DSH_PERMISSION_MODE='workspace-write' \
        --from-literal=DSH_SNAPSHOT_SESSIONS_ROOT='/data/.dsh-sessions' \
        --from-literal=ZSTD_BIN='/usr/bin/zstd' \
        --dry-run=client -o yaml | sudo k3s kubectl apply -f -" >/dev/null
    log_ok "secret 已生成（★ KEY_MASTER_SECRET 为一次性随机值，请立刻备份：丢失将无法解密已存的 LLM API Key）"
  fi

  # 3.3 configmap + 按目标机定制（DATABASE_URL 密码联动 / PREVIEW_DOMAIN）
  K apply -f ~/madazi-k8s/configmap.yaml >/dev/null
  K patch configmap madazi-config --type merge \
    -p "{\"data\":{\"DATABASE_URL\":\"postgresql://postgres:${POSTGRES_PASSWORD}@madazi-postgres:5432/madazi\",\"PREVIEW_DOMAIN\":\"${PREVIEW_DOMAIN}\"}}" >/dev/null
  log_ok "configmap 已定制（PREVIEW_DOMAIN=$PREVIEW_DOMAIN）"

  # 3.4 存储 + RBAC（必须在 server 之前：SA 不存在则 server Pod 起不来）
  K apply -f ~/madazi-k8s/pvc-postgres.yaml -f ~/madazi-k8s/pvc-projects.yaml >/dev/null
  log_ok "PVC 就绪（含 pods/exec 权限，K3s 终端必需）"

  # 3.5 数据库 → server → web（preview/dsh 由 server 动态创建裸 Pod，无需 YAML）
  log_info "部署 postgres（首次会从 mirror 拉 postgres:16-alpine）..."
  K apply -f ~/madazi-k8s/postgres-deployment.yaml -f ~/madazi-k8s/postgres-service.yaml >/dev/null
  K rollout status deploy/madazi-postgres --timeout=300s >/dev/null
  log_ok "postgres 就绪"

  K apply -f ~/madazi-k8s/server-deployment.yaml -f ~/madazi-k8s/server-service.yaml >/dev/null
  K rollout status deploy/madazi-server --timeout=300s >/dev/null
  log_ok "server 就绪"
}

# ────────────────────── 4. 验证 ──────────────────────
verify() {
  local host="${REMOTE#*@}"   # 去掉 user@
  log_info "验证 API health ..."
  local i=0
  until curl -sf "http://$host:30456/api/health" >/dev/null 2>&1; do
    i=$((i+1)); [ $i -gt 30 ] && { log_err "API 30s 未就绪"; K get pods; exit 1; }
    sleep 1
  done
  log_ok "API health 通过: http://$host:30456/api/health"

  echo
  echo "════════════ 部署完成 ════════════"
  echo "  API:      http://$host:30456   （/api/health）"
  echo "  预览域名: *.$PREVIEW_DOMAIN    （需 DNS 泛解析 + nginx 反代 → :30456）"
  echo "═════════════════════════════════"
}

show_status() {
  echo "════════════ Pods ════════════";  K get pods -o wide
  echo; echo "════════════ Services ════════════"; K get svc
  echo; echo "════════════ PVC ════════════"; K get pvc
}

# ────────────────────── 主流程 ──────────────────────
check_local
case "$PHASE" in
  k3s)    check_remote; install_k3s ;;
  images) check_remote; build_images "$REMOTE_ARCH"; import_images ;;
  apply)  check_remote; apply_yamls ;;
  verify) check_remote; verify ;;
  status) check_remote; show_status ;;
  all)
    check_remote
    install_k3s
    [ "${SKIP_BUILD:-0}" = "1" ] || build_images "$REMOTE_ARCH"
    import_images
    apply_yamls
    verify
    show_status
    ;;
  *) log_err "未知阶段 '$PHASE'"; echo "用法: $0 <user@host> [k3s|images|apply|verify|status|all]"; exit 1 ;;
esac
log_ok "🎉 阶段 [$PHASE] 完成"
