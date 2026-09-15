#!/usr/bin/env bash
# ============================================================
# madazi K3s 一键部署（现架构 2026-09-15 重写）
# 用法: ./deploy-k3s.sh [all|server|preview|verify|status] [--skip-build] [--skip-verify]
# 说明:
#   - 默认本机 colima-k3s（与构建同机）；远程（如公网 quda）设 REMOTE=user@host
#   - all    : 构建+导入 server/preview → apply 全部清单 → 等待 → 验证
#   - server : 只更新 server（新 tag 构建+导入+rollout）
#   - preview: 只更新 preview-runtime 镜像并 apply preview 清单
#   - verify : 不构建不 apply，只探活（server health / login 页 / pod 状态）
#   - status : 只看 pod/svc 状态
# 镜像矩阵（现架构）:
#   server     madazi-server:<TAG>    构建: madazi-server/Dockerfile（TAG 带日期，铁律:换镜像用新 tag）
#   dsh-web    madazi-dsh-web:latest  构建: scripts/build-dsh-web.sh（含 pack→import→rollout→PVC 版本）
#   preview    madazi-preview-*       构建: preview-runtime/Dockerfile(.node/.spring)（按需子镜像）
#   llm-gateway madazi-llm-gateway:g01 复用现网（无代码改动的面向开源部署默认复用）
# ★ 铁律（违规踩坑）:
#   · ctr 导入必须 -n k8s.io（else k3s 看不到 → ErrImageNeverPull 静默用旧镜像）
#   · 同 tag 重建：导入后必须 rollout restart（latest+IfNotPresent 复用旧镜像）
#   · configmap/secret 改动必须 rollout restart 生效
# ============================================================
set -euo pipefail

REMOTE="${REMOTE:-}"                       # 远程主机（空=本机 colima k3s）
NS=madazi
TAG="$(date +%m%d)"                        # 新 tag 后缀（ref-filter-0914 风格）
SERVER_IMG="madazi-server:ref-filter-${TAG}"
PREVIEW_IMG_BASE="madazi-preview-runtime"  # 通用导入子镜像；node/spring 变体按预览需求另建
CLUSTER_IP="${CLUSTER_IP:-127.0.0.1}"      # k3s 入口 IP（本地 colima NodePort 绑定 127.0.0.1）
NODE_PORT="${NODE_PORT:-30456}"

# ── 命令封装：load kube 命令（本机 colima / 远程 ssh）────────────────
K=""
if [ -n "${REMOTE}" ]; then
  K="ssh ${REMOTE} sudo k3s kubectl -n ${NS}"
  CTR_IN="ssh ${REMOTE} sudo k3s ctr -n k8s.io images import -"
  APPLY="ssh ${REMOTE} sudo k3s kubectl apply -f -"
else
  if colima ssh -p madazi -- sudo k3s kubectl get ns >/dev/null 2>&1; then
    K="colima ssh -p madazi -- sudo k3s kubectl -n ${NS}"
    CTR_IN="colima ssh -p madazi -- sudo k3s ctr -n k8s.io images import -"
    APPLY="colima ssh -p madazi -- sudo k3s kubectl apply -f -"
  elif command -v kubectl >/dev/null 2>&1 && kubectl get ns >/dev/null 2>&1; then
    K="kubectl -n ${NS}"
    # 本地非 sudo ctr 少见（用户态），默认走 kubectl debug 提示
    echo "⚠ 未检测到 colima(madazi)/远程 k3s，kubectl 可用则走本地" >&2
    CTR_IN=""
  else
    echo "✗ 无法访问 k3s（需 colima ssh -p madazi、REMOTE 或本机 kubectl）" >&2
    exit 1
  fi
fi
kk() { eval "${K} $*"; }

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")" && pwd)"
DO_BUILD=1; DO_VERIFY=1
for a in "$@"; do case "$a" in
  --skip-build) DO_BUILD=0;; --skip-verify) DO_VERIFY=0;;
esac; done

import_image() { # $1=本地镜像名(:tag)   ★ 必须 -n k8s.io
  docker save "$1" | eval "${CTR_IN}" || die "导入 ${1} 失败"
  ok "导入 ${1}"
}

build_server() {
  say "构建 server 镜像 ${SERVER_IMG}"
  ( cd "${ROOT}/madazi-server" && docker build -t "${SERVER_IMG}" . ) || die "server 构建失败"
  import_image "${SERVER_IMG}"
}

build_preview() {
  say "构建 preview 基础运行时镜像 ${PREVIEW_IMG_BASE}:latest"
  ( cd "${ROOT}/preview-runtime" && docker build -t "${PREVIEW_IMG_BASE}:latest" . ) || die "preview 构建失败"
  import_image "${PREVIEW_IMG_BASE}:latest"
}

apply_yaml() { # $1=file  → 通过 stdin 打到集群（避免 scp 依赖）
  cat "$1" | eval "${APPLY}" >/dev/null || die "apply $1 失败"
  ok "apply $(basename "$1")"
}

apply_all() {
  say "提示：dsh-web 镜像更新请先单独执行 scripts/build-dsh-web.sh（含 wb-src pack→profiles→import→rollout→PVC 版本自增），这里只 apply 其部署清单"
  say "apply 基础资源（namespace/configmap/secret/pvc/rbac）"
  for f in namespace configmap secret pvc-postgres pvc-projects rbac; do
    [ -f "${ROOT}/k8s/${f}.yaml" ] && apply_yaml "${ROOT}/k8s/${f}.yaml"
  done
  say "apply 数据面（postgres/redis/traefik/llm-gateway）"
  for f in postgres-deployment postgres-service redis-deployment redis traefik-crd traefik traefik-routes llm-gateway-deployment; do
    [ -f "${ROOT}/k8s/${f}.yaml" ] && apply_yaml "${ROOT}/k8s/${f}.yaml"
  done
  say "apply server + dsh-web + preview"
  # server tag 接口：默认清单用 ref-filter-0914 → 执行时按新 tag 覆盖（sed 管道）
  sed "s|image: madazi-server:ref-filter-.*|image: ${SERVER_IMG}|" "${ROOT}/k8s/server-deployment.yaml" | eval "${APPLY}" >/dev/null && ok "apply server-deployment (${SERVER_IMG})"
  apply_yaml "${ROOT}/k8s/server-service.yaml"
  apply_yaml "${ROOT}/k8s/dsh-web-deployment.yaml"
  apply_yaml "${ROOT}/k8s/preview-deployment.yaml"
  apply_yaml "${ROOT}/k8s/preview-service.yaml"
}

wait_rollouts() {
  say "等待 rollout"
  for dep in madazi-postgres madazi-redis madazi-server madazi-dsh-web madazi-llm-gateway; do
    kk rollout status "deployment/${dep}" --timeout=180s >/dev/null 2>&1 && ok "${dep} 就绪" || echo "⚠ ${dep} 未就绪（可能未部署）"
  done
}

verify() {
  say "verify 探活"
  kk get pods 2>/dev/null | tail -n +1 | head -12
  echo ""
  # 1) 网络层：traefik NodePort 可达即入口通（域名未匹配时 traefik 返回 404 属预期，
  #    不是部署失败——IngressRoute 按 Host 路由，裸 IP 无匹配）
  local base="http://${CLUSTER_IP}:${NODE_PORT}"
  local code
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "${base}" 2>/dev/null || echo 000)
  echo "traefik 入口 ${base} → HTTP ${code}"
  [ "${code}" != "000" ] || die "入口不可达（检查 traefik/NodePort；本机用 CLUSTER_IP=127.0.0.1）"
  ok "入口可达（HTTP ${code}：404=域名未匹配属预期；用域名 URL 验应用层）"
  # 2) 应用层：域名 URL（默认线上 Demo；开源裸机部署请设 VERIFY_URL=http://<你的域名>）
  local vurl="${VERIFY_URL:-https://<YOUR-DOMAIN>}"
  local api
  api=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "${vurl}/api/health" 2>/dev/null || echo 000)
  echo "server /api/health (${vurl}) → HTTP ${api}"
  [ "${api}" = "200" ] && ok "server 健康" || { echo "⚠ server 健康检查未过（${api}）——裸机无域名时设 VERIFY_URL 后重跑 --skip-build verify，或忽略仅看 pod Ready）"; }
  local page
  page=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "${vurl}/dsh-web/" 2>/dev/null || echo 000)
  echo "dsh-web 登录页 (${vurl}/dsh-web/) → HTTP ${page}"
  [ "${page}" = "200" ] && ok "dsh-web 可达" || echo "⚠ dsh-web 页面状态 ${page}"
}

status() {
  kk get pods -o wide 2>&1 | head -15
  echo ""
  kk get svc 2>&1 | head -10
}

# ── 主流程 ───────────────────────────────────────────────────────
TARGET="${1:-all}"; [ "${TARGET#--}" != "${TARGET}" ] && TARGET=all
case "${TARGET}" in
  all)
    [ "${DO_BUILD}" = "1" ] && { build_server; }
    [ -n "${CTR_IN}" ] || die "无法导入镜像（本机 ctr 不可用，请 REMOTE 或检查 colima）"
    apply_all
    wait_rollouts
    [ "${DO_VERIFY}" = "1" ] && verify
    ;;
  server)
    [ "${DO_BUILD}" = "1" ] && build_server
    sed "s|image: madazi-server:ref-filter-.*|image: ${SERVER_IMG}|" "${ROOT}/k8s/server-deployment.yaml" | eval "${APPLY}" >/dev/null
    kk rollout status deployment/madazi-server --timeout=180s >/dev/null && ok "server 更新完成" || die "server rollout 超时"
    [ "${DO_VERIFY}" = "1" ] && verify
    ;;
  preview)
    [ "${DO_BUILD}" = "1" ] && build_preview
    apply_yaml "${ROOT}/k8s/preview-deployment.yaml"
    [ "${DO_VERIFY}" = "1" ] && kk rollout status deployment/madazi-preview --timeout=180s >/dev/null 2>&1 || true
    ;;
  verify) [ "${DO_VERIFY}" = "1" ] && verify ;;
  status) status ;;
  *)
    die "未知 target：${TARGET}（all|server|preview|verify|status）"
    ;;
esac
ok "完成"