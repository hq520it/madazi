#!/usr/bin/env bash
# ============================================================
# madazi 开源投放脚本（单仓双形态：单机版 + K8s 云版）——干净推送
# 作用：把当前工作树净化后复制到 opensource-dist/（可独立 git init），
#       不做任何外部推送——推送由持有者确认后手动执行。
# 形态：开源 K8s 云版 —— 保留 k8s/ 裸清单、deploy/helm、deploy-k3s*.sh、
#       deploy-k8s-remote.sh、docs/ARCHITECTURE 等部署文档；剔除内部设计文档
#       （doc/、docs/prd|wiki|marketing|HANDOFF|ONBOARDING|single-node）与单机版专述。
# 排除：私有目录/构建产物/凭证；专利文件；内部文档。
# 脱敏：gaoyuanqiu.com / 服务器 IP / frp token / JWT / PG 口令 → 占位符（全局文本替换）。
# 原则：★ 工作树零改动 —— 全部排除与脱敏只作用于投放副本。
# 用法：./scripts/publish-opensource.sh [--commit]
#   --commit  : rsync+sed 完成后在 opensource-dist 里 git init + 首次 commit
#   默认只产出净化副本，便于先人工检查。
# 前置：仓库根（standalone 分支，含 k8s 部署全套）执行；rsync 可用
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/opensource-dist"
DO_COMMIT=0
[ "${1:-}" = "--commit" ] && DO_COMMIT=1

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "${ROOT}/.git" ] || die "请在 madazi 仓库根目录运行"
command -v rsync >/dev/null || die "需要 rsync"

say "1/4 清理旧投放目录"
rm -rf "${OUT}"
mkdir -p "${OUT}"

say "2/4 rsync 净化副本（排除私有/构建/凭证/专利 + 内部文档；保留 k8s 部署）"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'opensource-dist/' \
  --exclude 'opensource-dist/' \
  --exclude 'node_modules/' \
  --exclude 'generated/' \
  --exclude '.trae/' \
  --exclude '.hermes/' \
  --exclude '.agents/' \
  --exclude '.dsh-patch/' \
  --exclude '.video_assets/' \
  --exclude '.DS_Store' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.log' \
  --exclude '*.pem' \
  --exclude '*_token.txt' \
  --exclude 'madazi-k8s-token.txt' \
  --exclude 'k8s-dashboard-token.txt' \
  --exclude 'docs/patent/' \
  --exclude 'wb-src/.git/' \
  --exclude 'dsh-src/.git/' \
  --exclude 'scripts/keys/' \
  --exclude 'madazi-server/scripts/test-dsh-*.mjs' \
  --exclude 'doc/' \
  --exclude 'docs/HANDOFF-*.md' \
  --exclude 'docs/ONBOARDING.md' \
  --exclude 'docs/marketing/' \
  --exclude 'docs/assets/' \
  --exclude 'docs/prd/' \
  --exclude 'docs/wiki/' \
  --exclude 'docs/topology.html' \
  --exclude 'docs/ARCHITECTURE.html' \
  --exclude 'docs/single-node.md' \
  --exclude 'brand/' \
  --exclude 'assets/' \
  "${ROOT}/" "${OUT}/"

# wb-src/dsh-src 嵌套 .gitignore 规则移除（同单机版；避免误伤 fork 子目录）
sed -i '' '/^wb-src\/$/d' "${OUT}/.gitignore" 2>/dev/null || true
sed -i '' '/^dsh-src\/$/d' "${OUT}/.gitignore" 2>/dev/null || true

say "2b/4 构建产物开发机路径清理（#region 注释正则，任意用户目录）"
DEV_PATH_RE='s|/Users/[^/][^/]*/code/madazi/|./|g'
cleanup_paths() {
  local n
  n=$(grep -rlE '/Users/[^/][^/]*/code/madazi/' "${OUT}/dsh-src/packages" "${OUT}/wb-src" "${OUT}/madazi-server/docker/acp/dsh-src-dist" 2>/dev/null | grep -v '/\.git/' | wc -l | tr -d ' ' || true)
  [ "${n}" = "0" ] && return
  grep -rlE '/Users/[^/][^/]*/code/madazi/' "${OUT}/dsh-src/packages" "${OUT}/wb-src" "${OUT}/madazi-server/docker/acp/dsh-src-dist" 2>/dev/null | grep -v '/\.git/' \
    | while IFS= read -r f; do
        sed -i '' "${DEV_PATH_RE}" "$f"
      done
  echo "  已清理 ${n} 个产物的开发机路径"
}
cleanup_paths

say "3/4 脱敏（全局文本占位符替换：域名/服务器 IP/frp token/JWT/PG 口令）"
# grep -I 自动跳过二进制（含 NUL 字节），只处理文本文件，防止 sed 破坏制品
scrub() { # $1=正则  $2=替换值  ★ sed 用 | 分隔（模式/替换含 /，默认分隔必炸）
  grep -rlIe "$1" "${OUT}" 2>/dev/null | grep -v '\.git/' | grep -v 'scripts/publish-opensource' \
    | while IFS= read -r f; do
        sed -i '' "s|$1|$2|g" "$f" 2>/dev/null || true
      done
}
scrub 'madazi\.gaoyuanqiu\.com' '<YOUR-DOMAIN>'
scrub 'gaoyuanqiu' '<YOUR-DOMAIN>'
scrub '/Users/mac/' '$HOME/'
scrub '175\.178\.76\.16' '<SERVER-IP>'
scrub 'madazi-frp-2026' '<FRP-TOKEN>'
scrub 'madazi-jwt-secret-2026' 'CHANGE-ME-JWT-SECRET'
scrub 'madazi2024' 'CHANGE-ME-POSTGRES-PASSWORD'

say "3b/4 双形态 README 覆盖（模板固化于 scripts/oss-README.*）"
cp "${ROOT}/scripts/oss-README.md" "${OUT}/README.md"
cp "${ROOT}/scripts/oss-README.en.md" "${OUT}/README.en.md"

say "4/4 残留敏感自查（投放副本内应无命中；排除脚本自身模式字面）"
HITS=$(grep -rIlE \
  'gaoyuanqiu|/Users/mac/|175\.178\.76\.16|madazi-frp-2026|madazi-jwt-secret-2026|madazi2024|BEGIN [A-Z ]*PRIVATE KEY' \
  "${OUT}" 2>/dev/null | grep -v 'scripts/publish-opensource' | wc -l | tr -d ' ' || true)
if [ "${HITS}" != "0" ]; then
  echo "⚠ 仍检出 ${HITS} 处敏感命中："
  grep -rIlE 'gaoyuanqiu|/Users/mac/|175\.178\.76\.16|madazi-frp-2026|madazi-jwt-secret-2026|madazi2024|BEGIN [A-Z ]*PRIVATE KEY' "${OUT}" 2>/dev/null | grep -v 'scripts/publish-opensource' | head
  die "终止：请补充排除/脱敏后再投放"
fi
ok "投放副本敏感残留 0"

if [ "${DO_COMMIT}" = "1" ]; then
  say "git init + 首次 commit"
  missing=''
  for chk in \
    "madazi-server/docker/acp/plugins/dsh-plugin-madazi/lib/client.js|客户端插件" \
    "madazi-server/docker/acp/plugins/dsh-plugin-login/lib/client.js|登录插件" \
    "madazi-server/docker/acp/profiles-web/dsh-workbench-plugin-0.1.35.tgz|workbench tgz" \
    "dsh-src/packages/client/connection/lib/client.js|dsh fork connection 产物" \
    "dsh-src/packages/client/ui-skill/lib/client.js|dsh fork ui-skill 产物" \
    "dsh-src/packages/client/ui-workspace/lib/client.js|dsh fork ui-workspace 产物" \
    "wb-src/lib/client.js|wb-src 构建产物" \
    "k8s/traefik.yaml|k8s 部署清单" \
    "deploy/helm/madazi/Chart.yaml|helm chart" \
    "deploy-k3s.sh|k3s 一键部署脚本" ; do
    f="${chk%%|*}"; label="${chk##*|}"
    [ -f "${OUT}/${f}" ] || { echo "✗ 开源包缺 ${label}: ${f}"; missing=1; }
  done
  [ -z "${missing}" ] || die "k8s 版必备文件缺失，中止投放"
  echo "  k8s 版可运行产物校验通过（${n:-10}/10）"
  git -C "${OUT}" init -q
  git -C "${OUT}" add -A
  git -C "${OUT}" add -f \
    dsh-src/packages/client/connection/lib \
    dsh-src/packages/client/ui-skill/lib \
    dsh-src/packages/client/ui-workspace/lib \
    wb-src/lib
  git -C "${OUT}" -c user.name="madazi-bot" -c user.email="madazi@users.noreply.github.com" commit -qm "madazi initial open-source release"
  ok "opensource-dist 已 git init 并完成首次 commit"
fi

ok "完成。投放目录：${OUT}"