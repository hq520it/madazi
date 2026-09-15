#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# madazi 本机 K3s (colima) 一键部署脚本
#
# 用法:
#   ./deploy-k3s-colima.sh            # 部署全部（web + server + worker + preview）
#   ./deploy-k3s-colima.sh server     # 只部署 server
#   ./deploy-k3s-colima.sh web        # 只部署 web
#   ./deploy-k3s-colima.sh worker     # 只部署 worker
#   ./deploy-k3s-colima.sh preview    # 只部署 preview（node/spring/runtime 三镜像）
#   ./deploy-k3s-colima.sh status     # 只看 Pod/服务状态
#
# 流程: 本地 docker build → save → colima K3s ctr 导入 → rollout restart → 等就绪
# 依赖: colima (profile: madazi) + K3s + kubectl
# ═══════════════════════════════════════════════════════════════
set -e

PROFILE="madazi"
NS="madazi"
DOCKER_SOCK="unix://$HOME/.colima/${PROFILE}/docker.sock"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

K() { colima ssh -p "$PROFILE" -- sudo k3s kubectl "$@"; }

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $1"; }

# 校验前置条件
check_env() {
  if ! command -v colima >/dev/null 2>&1; then
    log_err "未找到 colima，请先安装"; exit 1
  fi
  if ! colima list 2>/dev/null | grep -qE "^${PROFILE}\s+Running"; then
    log_err "colima profile '${PROFILE}' 未运行，请先启动: colima start -p ${PROFILE}"
    exit 1
  fi
  export DOCKER_HOST="$DOCKER_SOCK"
  log_ok "DOCKER_HOST=$DOCKER_HOST"
}

# 构建镜像（在目标目录）
build_image() {
  local name=$1 dir=$2 dockerfile=${3:-Dockerfile}
  log_info "构建 $name ($dir/$dockerfile) ..."
  ( cd "$PROJECT_ROOT/$dir" && docker build ${dockerfile:+-f "$dockerfile"} -t "$name:latest" . ) \
    || { log_err "构建 $name 失败"; exit 1; }
  log_ok "构建完成 $name:latest"
}

# 导入镜像到 K3s
# ★ 必须带 -n k8s.io：不带 namespace 导入会落到 containerd default 命名空间，
#   k3s Pod 永远看不到（静默用旧镜像，ErrImageNeverPull 的隐形变体）
import_images() {
  local names=("$@")
  log_info "导入镜像到 K3s: ${names[*]} ..."
  docker save "${names[@]/%/:latest}" | colima ssh -p "$PROFILE" -- sudo k3s ctr -n k8s.io images import - \
    || { log_err "镜像导入失败"; exit 1; }
  log_ok "镜像导入完成"
}

# 滚动重启并等待就绪
rollout() {
  local deps=("$@")
  log_info "滚动重启: ${deps[*]} ..."
  K -n "$NS" rollout restart "${deps[@]/#/deploy/}" >/dev/null
  K -n "$NS" rollout status "${deps[@]/#/deploy/}" --timeout=180s
  log_ok "部署就绪: ${deps[*]}"
}

# 针对由 server 运行时动态创建的资源：存在静态对象则重启，不存在则仅更新镜像
# （worker / dsh / preview 在本集群由 server 按需动态创建裸 Pod，无对应 Deployment）
rollout_if_present() {
  local kind=$1 name=$2
  if K -n "$NS" get "$kind" "$name" >/dev/null 2>&1; then
    log_info "滚动重启: $kind/$name ..."
    K -n "$NS" rollout restart "$kind/$name" >/dev/null
    K -n "$NS" rollout status "$kind/$name" --timeout=180s
    log_ok "部署就绪: $kind/$name"
  else
    log_warn "未找到 $kind/$name，该资源由 server 运行时动态创建，本次仅更新镜像，后续动态拉起时生效"
  fi
}

show_status() {
  echo
  echo "════════════ Pod 状态 ════════════"
  K -n "$NS" get pods -o wide
  echo
  echo "════════════ Service ════════════"
  K -n "$NS" get svc
  echo
  echo "访问: Web http://<colima-ip>:30088 / API http://<colima-ip>:30456"
  echo "（生产域名走 quda 反隧道: <YOUR-DOMAIN>）"
}

# ────────────────────────── 构建/部署各组件 ──────────────────────────
deploy_server() {
  build_image madazi-server madazi-server
  import_images madazi-server
  rollout madazi-server
}

deploy_web() {
  build_image madazi-web madazi-web
  import_images madazi-web
  rollout madazi-web
}

deploy_worker() {
  build_image madazi-worker madazi-server Dockerfile.worker
  import_images madazi-worker
  rollout_if_present deployment madazi-worker
}

deploy_preview() {
  # 依赖顺序: node ← spring（FROM madazi-preview-node），runtime 独立
  build_image madazi-preview-node preview-runtime Dockerfile.node
  build_image madazi-preview-spring preview-runtime Dockerfile.spring
  build_image madazi-preview-runtime preview-runtime Dockerfile
  import_images madazi-preview-node madazi-preview-spring madazi-preview-runtime
  rollout_if_present deployment madazi-preview
}

# ────────────────────────── 主流程 ──────────────────────────
TARGET="${1:-all}"

case "$TARGET" in
  status)  check_env; show_status ;;
  server)  check_env; deploy_server ;;
  worker)  check_env; deploy_worker ;;
  preview) check_env; deploy_preview ;;
  all)
    check_env
    deploy_server
    deploy_worker
    deploy_preview
    show_status
    ;;
  *)
    log_err "未知目标 '$TARGET'"
    echo "用法: $0 [all|server|worker|preview|status]"
    exit 1
    ;;
esac

log_ok "🎉 部署完成: $TARGET"
