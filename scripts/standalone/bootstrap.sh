#!/usr/bin/env bash
# ============================================================
# madazi 单机版 bootstrap —— 一次性安装（免 docker/k8s）
# 作用：装好「dsh 承载体 + fork 产物覆盖 + madazi 插件 + workbench profiles」，
#       之后 start.sh 即可拉起双进程。
# 用法：bash scripts/standalone/bootstrap.sh
# 前置：Node ≥ 22、pnpm、PostgreSQL ≥ 14（本机已安装并启动）
# 约定：DSH_HOME 默认 ~/.madazi/dsh-home（可用环境变量覆盖）
# 环境变量（可覆盖）：
#   NPM_REGISTRY   默认 https://registry.npmmirror.com（npm/pnpm 共用，海外可设 https://registry.npmjs.org）
# ============================================================
set -euo pipefail
MADAZI="$(cd "$(dirname "$0")/../.." && pwd)"
DSH_SRC="${MADAZI}/dsh-src"
ACP="${MADAZI}/madazi-server/docker/acp"
DSH_HOME="${DSH_HOME:-$HOME/.madazi/dsh-home}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# sed -i 的跨平台写法（macOS BSD sed 需要空扩展名参数，GNU sed 不需要）
sedi() {
  if [[ "$(uname)" == "Darwin" ]]; then sed -i '' "$@"; else sed -i "$@"; fi
}

# ── 0 前置检查 ───────────────────────────────────────────
command -v node >/dev/null || die "需要 Node.js ≥ 22（https://nodejs.org）"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || die "Node 版本过低（需 ≥ 22，当前 $(node -v)）"
command -v pnpm >/dev/null || die "需要 pnpm（npm i -g pnpm）"
if [ ! -f "${DSH_SRC}/packages/client/connection/lib/client.js" ]; then
  echo "  dsh-src fork 产物缺失 → 自动构建（cd dsh-src && pnpm install && pnpm build）"
  ( cd "${DSH_SRC}" \
    && pnpm install --config.confirmModulesPurge=false --config.minimumReleaseAge=0 --registry="${NPM_REGISTRY}" \
    && pnpm build ) \
    || die "dsh-src 构建失败（可 cd dsh-src && pnpm install && pnpm build 手动排查后重试）"
fi

PREFIX="$(npm prefix -g)"
DSH_ROOT="${PREFIX}/lib/node_modules/@deepseek-ai/dsh"

# ── 1 dsh 承载体（CLI 入口 + 依赖树骨架）───────────────
say "1/6 dsh 承载体（npm 包：CLI 入口 + 依赖声明）"
node -e "const p=require('${DSH_ROOT}/package.json');process.exit(p.version==='0.1.5-rc.1'?0:1)" 2>/dev/null \
  && echo "  已装 @deepseek-ai/dsh@0.1.5-rc.1，复用" \
  || npm i -g @deepseek-ai/dsh@0.1.5-rc.1 --registry="${NPM_REGISTRY}"

# ── 1b madazi-server 依赖（平台 API 运行所需）───────────
say "2/6 madazi-server 依赖（npm install）"
( cd "${MADAZI}/madazi-server" && npm install --no-audit --no-fund --registry="${NPM_REGISTRY}" ) \
  || die "madazi-server npm install 失败（海外网络可 NPM_REGISTRY=https://registry.npmjs.org 重试）"

# ── 2 fork 产物覆盖（内核定制随本机全局树生效）────────
say "3/6 fork 产物覆盖（connection / ui-skill / ui-workspace）"
DST="${DSH_ROOT}/node_modules/@deepseek-ai"
for pkg in connection ui-skill ui-workspace; do
  # ★ 官方包 lib 已存在，先整体替换（cp -R 直接覆盖会把源嵌套成 lib/lib）
  rm -rf "${DST}/dsh-client-${pkg}/lib"
  cp -R "${DSH_SRC}/packages/client/${pkg}/lib" "${DST}/dsh-client-${pkg}/lib"
  cp "${DSH_SRC}/packages/client/${pkg}/package.json" "${DST}/dsh-client-${pkg}/package.json"
done
grep -q "__DSH_TRUSTED_LOOPBACK__" "${DST}/dsh-client-connection/lib/client.js" \
  || die "loopback 标记缺失（fork 产物未同步）"
grep -q "invalidate(session.sessionId)" "${DST}/dsh-client-ui-skill/lib/client.js" \
  || die "skill 刷新标记缺失"
grep -q "gatedWorkspaces" "${DST}/dsh-client-ui-workspace/lib/client.js" \
  || die "membership gate 标记缺失"

# ── 3 madazi 插件（登录门 + 平台面板）─────────────────
say "4/6 madazi 插件（@madazi/dsh-plugin-madazi + dsh-plugin-login）"
MP="${DSH_ROOT}/node_modules/@madazi"
mkdir -p "${MP}"
rm -rf "${MP}/dsh-plugin-madazi" "${MP}/dsh-plugin-login"
cp -R "${ACP}/plugins/dsh-plugin-madazi" "${MP}/dsh-plugin-madazi"
cp -R "${ACP}/plugins/dsh-plugin-login" "${MP}/dsh-plugin-login"
grep -q "LoginOverlay" "${MP}/dsh-plugin-login/lib/client.js" || die "login 插件缺登录表单标记"

# ── 4 workbench profiles 铺进 DSH_HOME ─────────────────
say "5/6 workbench profiles（$DSH_HOME/profiles/web）"
mkdir -p "${DSH_HOME}/profiles"
if [ ! -d "${DSH_HOME}/profiles/web/node_modules/dsh-workbench-plugin" ]; then
  rm -rf "${DSH_HOME}/profiles/web"
  cp -R "${ACP}/profiles-web" "${DSH_HOME}/profiles/web"
  # ★ k8s 版把 pnpm store 固化在 PVC（/app/generated/.dsh/.pnpm-store）；本机需改到
  #   DSH_HOME 内可写处，否则 pnpm install 会写只读路径失败
  mkdir -p "${DSH_HOME}/.pnpm-store"
  sedi "s|storeDir: /app/generated/.dsh/.pnpm-store|storeDir: ${DSH_HOME}/.pnpm-store|" \
    "${DSH_HOME}/profiles/web/pnpm-workspace.yaml"
  ( cd "${DSH_HOME}/profiles/web" \
    && pnpm install --config.confirmModulesPurge=false --config.minimumReleaseAge=0 --registry="${NPM_REGISTRY}" ) \
    || die "profiles pnpm install 失败"
  # ★ madazi 插件符号链接：k8s 构建期由 Dockerfile 铺进 profile node_modules；
  #   本机由 bootstrap 建链接（指向全局 dsh 树的 @madazi/*），dsh web 才能解析 bundles
  MP_SRC="${DSH_ROOT}/node_modules/@madazi"
  LNK="${DSH_HOME}/profiles/web/node_modules/@madazi"
  mkdir -p "${LNK}"
  for plug in dsh-plugin-login dsh-plugin-madazi; do
    if [ ! -e "${LNK}/${plug}" ]; then
      ln -s "${MP_SRC}/${plug}" "${LNK}/${plug}"
    fi
  done
fi
grep -q "wb-splash-css" "${DSH_HOME}/profiles/web/node_modules/dsh-workbench-plugin/lib/client.js" \
  || die "workbench 插件未就位（splash 标记缺失）"

# ★ 全文会话搜索：base/web-app bundle 默认 session-query-sqlite openAt: never
#   （仅标题匹配、search RPC 抛 SESSION_QUERY_SEARCH_DISABLED → 侧栏「无匹配会话」）。
#   按官方文档在 profile patch 层（later layer）覆盖为 first-search（首次搜索惰性建索引）。
if ! grep -q "session-query-sqlite" "${DSH_HOME}/profiles/web/cordis.patch.yml" 2>/dev/null; then
  cat > "${DSH_HOME}/profiles/web/cordis.patch.yml" <<'PATCHEOF'
# locale 服务：dsh-workbench-plugin 0.1.25 起官方已修复，无需禁用（保留空数组占位历史）。
# ★ 开启全文会话搜索：覆盖 base/web-app 的 session-query-sqlite 默认 openAt: never
#   （never → search 抛 SESSION_QUERY_SEARCH_DISABLED，侧栏搜索显示「无匹配会话」）。
#   first-search：首次搜索时惰性建内存索引，Node 22 启动零开销；重启后重建即可。
- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: ':memory:'
    openAt: first-search
PATCHEOF
  echo "  profiles/web/cordis.patch.yml <- 开启全文搜索（openAt: first-search）"
fi

# ── 6 汇总 ──────────────────────────────────────────────
echo
echo "bootstrap 完成 ✅"
echo "  DSH_HOME   = ${DSH_HOME}"
echo "  数据/配置   个人会话与配置落 DSH_HOME（备份它即可迁移）"
echo "  平台数据    需 PostgreSQL（启动前先建库，见 start.sh 提示）"
echo "  下一步     bash scripts/standalone/start.sh"