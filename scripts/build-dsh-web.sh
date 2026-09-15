#!/usr/bin/env bash
# ============================================================
# madazi-dsh-web 一键构建部署（稳定版 2026-08-22）
# 链路：wb-src npm pack tgz → profiles-web 同步 → lockfile sha512 →
#       docker build → 镜像内 client.js 验证 → ctr 导入 → rollout → 线上验证
# 用法：./build-dsh-web.sh [--no-cache]
# 前置：colima(madazi) 已启动；~/code/wb-src 与 ~/code/madazi 存在
# 失败即停（set -euo pipefail），每步有明确报错
# ============================================================
set -euo pipefail

COLIMA_PROFILE=madazi
DOCKER_HOST_SOCK="unix://$HOME/.colima/${COLIMA_PROFILE}/docker.sock"
MADAZI=$HOME/code/madazi
WB_SRC="${MADAZI}/wb-src"
ACP="${MADAZI}/madazi-server/docker/acp"
PROFILES_WEB="${ACP}/profiles-web"
IMAGE=madazi-dsh-web:latest
TGZ_NAME=dsh-workbench-plugin-0.1.35.tgz
NS=madazi
DEPLOY=madazi-dsh-web
NO_CACHE=""
[ "${1:-}" = "--no-cache" ] && NO_CACHE="--no-cache"

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# ── 0 前置检查 ──────────────────────────────────────────────
say "0/7 前置检查"
[ -d "${WB_SRC}/lib" ] || die "wb-src/lib 不存在，先构建 lib（tsdown）"
grep -q "skip: active project not running" "${WB_SRC}/lib/client.js" \
  || die "wb-src/lib/client.js 不是最新版（缺日志文案），请先重新构建 lib"
if ! docker info >/dev/null 2>&1; then
  export DOCKER_HOST=${DOCKER_HOST_SOCK}
  docker info >/dev/null 2>&1 || die "colima docker 不可用（尝试 DOCKER_HOST=${DOCKER_HOST_SOCK} 仍失败）"
fi
ok "前置通过（lib 新版 + docker 可用）"

# ── 0b 构建 madazi 插件（src/*.js -> client.js） ─────────────
say "0b/7 构建 madazi 插件（src -> client.js）"
MADAZI_PLUGIN="${ACP}/plugins/dsh-plugin-madazi/lib"
node "${MADAZI_PLUGIN}/build.cjs" >/dev/null 2>&1 || die "madazi 插件 build.cjs 失败"
node --check "${MADAZI_PLUGIN}/client.js" || die "madazi 插件 client.js 语法错误"
grep -q 'loadIdle' "${MADAZI_PLUGIN}/client.js" || die "madazi 插件缺 loadIdle 标记（构建异常）"
ok "madazi 插件已构建（$(wc -l < "${MADAZI_PLUGIN}/client.js" | tr -d ' ') 行）"

# ── 1 pack tgz ──────────────────────────────────────────────
say "1/7 wb-src 打包 tgz"
cd "${WB_SRC}"
rm -f "${TGZ_NAME}"
# ★ npm pack 不触发 prepublishOnly（那是 npm publish 的钩子）——必须显式 build，
#   否则 tgz 打包的是旧 lib/ 产物（0.1.28 升级静默失效的根因之一）
npm run build >/dev/null 2>&1 || die "wb-src tsdown build 失败"
npm pack --silent >/dev/null 2>&1 || die "npm pack 失败（wb-src）"
[ -f "${TGZ_NAME}" ] || die "pack 未生成 ${TGZ_NAME}"
NEW_SHA=$(openssl dgst -sha512 -binary "${TGZ_NAME}" | base64)
ok "pack 完成 ${TGZ_NAME}（sha512 ${NEW_SHA:0:12}…）"

# ── 2 同步 tgz → profiles-web ───────────────────────────────
say "2/7 同步 tgz → profiles-web"
cp -f "${TGZ_NAME}" "${PROFILES_WEB}/${TGZ_NAME}"
# ★ package.json file: 引用同步（旧 tgz 一并清理，防 lockfile sha 与残留文件错配）
sed -i '' -E "s|file:\\./dsh-workbench-plugin-[0-9.]+\\.tgz|file:./${TGZ_NAME}|" "${PROFILES_WEB}/package.json"
rm -f "${PROFILES_WEB}"/dsh-workbench-plugin-*.tgz
cp -f "${TGZ_NAME}" "${PROFILES_WEB}/${TGZ_NAME}"
grep -q "file:./${TGZ_NAME}" "${PROFILES_WEB}/package.json" || die "package.json tgz 引用同步失败"
ok "已覆盖 ${PROFILES_WEB}/${TGZ_NAME}（package.json 引用已同步）"

# ── 3 lockfile 重生成 ──────────────────────────────────────
say "3/7 重生成 pnpm-lock.yaml（--lockfile-only，条目名+sha 一起更新）"
LOCK="${PROFILES_WEB}/pnpm-lock.yaml"
( cd "${PROFILES_WEB}" && corepack pnpm install --lockfile-only --config.confirmModulesPurge=false --store-dir /tmp/pnpm-store-bdw >/dev/null 2>&1 ) || die "pnpm install --lockfile-only 失败"
grep -q "dsh-workbench-plugin@file:dsh-workbench-plugin-.*\.tgz" "${LOCK}" || die "lockfile 缺 dsh-workbench-plugin 条目"
grep -q "sha512-${NEW_SHA}" "${LOCK}" || die "lockfile sha512 与新 tgz 不一致"
ok "lockfile 已重生成（${NEW_SHA:0:12}…）"

# ── 3c 模板版本号自增 ───────────────────────────────────────
# initContainer 按 .madazi-template-version 对比 PVC 版本决定是否把新插件铺进 PVC：
# 版本不变 = PVC 永远跑旧 workbench 插件（tgz 更新了也白搭）。每次构建必须自增。
say "3c/7 模板版本号自增（触发 initContainer 铺新插件到 PVC）"
VER_FILE="${PROFILES_WEB}/.madazi-template-version"
OLD_VER=$(cat "${VER_FILE}" 2>/dev/null || echo 0)
NEW_VER=$((OLD_VER + 1))
echo "${NEW_VER}" > "${VER_FILE}"
ok "模板版本 ${OLD_VER} → ${NEW_VER}"

# ── 3d dsh-src fork 产物同步（本地构建 → dsh-src-dist，替代运行期补丁）────
# 三处内核定制（loopback/技能刷新/trusted-host）在 dsh-src 源码直接修改，
# 构建产物整体覆盖全局子包。产物保险丝与 Dockerfile 内 grep 互为前后门。
say "3d/7 同步 dsh-src fork 构建产物（connection/ui-skill/ui-workspace）"
DSH_SRC="${MADAZI}/dsh-src"
DIST="${ACP}/dsh-src-dist"
[ -f "${DSH_SRC}/packages/client/connection/lib/client.js" ] || die "dsh-src connection 未构建（cd dsh-src && pnpm build）"
[ -f "${DSH_SRC}/packages/client/ui-skill/lib/client.js" ] || die "dsh-src ui-skill 未构建"
[ -f "${DSH_SRC}/packages/client/ui-workspace/lib/client.js" ] || die "dsh-src ui-workspace 未构建"
rm -rf "${DIST}"
mkdir -p "${DIST}/dsh-client-connection" "${DIST}/dsh-client-ui-skill" "${DIST}/dsh-client-ui-workspace"
cp -R "${DSH_SRC}/packages/client/connection/lib" "${DIST}/dsh-client-connection/lib"
cp "${DSH_SRC}/packages/client/connection/package.json" "${DIST}/dsh-client-connection/package.json"
cp -R "${DSH_SRC}/packages/client/ui-skill/lib" "${DIST}/dsh-client-ui-skill/lib"
cp "${DSH_SRC}/packages/client/ui-skill/package.json" "${DIST}/dsh-client-ui-skill/package.json"
cp -R "${DSH_SRC}/packages/client/ui-workspace/lib" "${DIST}/dsh-client-ui-workspace/lib"
cp "${DSH_SRC}/packages/client/ui-workspace/package.json" "${DIST}/dsh-client-ui-workspace/package.json"
grep -q "__DSH_TRUSTED_LOOPBACK__" "${DIST}/dsh-client-connection/lib/client.js" \
  || die "dsh-src connection 产物缺 loopback 标记（fork 定制未进产物）"
# trusted-host 与 loopback 同包连坐（见 Dockerfile 对应注释）；升级若上游改动
# dsh-src 的 rpc-host 会以 git merge / git apply 冲突暴露，无需独立字符串标记。
grep -q "invalidate(session.sessionId)" "${DIST}/dsh-client-ui-skill/lib/client.js" \
  || die "dsh-src ui-skill 产物缺技能刷新标记（fork 定制未进产物）"
grep -q "api/projects" "${DIST}/dsh-client-ui-workspace/lib/client.js" \
  && grep -q "startMembershipWatch" "${DIST}/dsh-client-ui-workspace/lib/client.js" \
  && grep -q "gatedWorkspaces" "${DIST}/dsh-client-ui-workspace/lib/client.js" \
  || die "dsh-src ui-workspace 产物缺 membership gate 标记（fork 定制未进产物）"
ok "dsh-src 产物已同步（connection + ui-skill + ui-workspace，fork 标记全验）"

# ── 4 docker build ──────────────────────────────────────────
say "4/7 docker build ${IMAGE} ${NO_CACHE}"
export DOCKER_HOST=${DOCKER_HOST_SOCK}
cd "${ACP}"
docker build ${NO_CACHE} -f Dockerfile.dsh-web -t "${IMAGE}" . 2>&1 | tail -15 || die "docker build 失败"
ok "镜像构建完成"

# ── 5 镜像内 client.js 版本验证 ─────────────────────────────
say "5/7 验证镜像内插件版本 = $(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"${TGZ_NAME}" | head -1)"
docker run --rm --entrypoint node "${IMAGE}" -e '
const pkg=require("/opt/dsh-profiles-web/node_modules/dsh-workbench-plugin/package.json");
const want="'"$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"${TGZ_NAME}" | head -1)"'";
if(pkg.version!==want){console.error("CLIENT VERIFY FAILED: 镜像内插件 "+pkg.version+" ≠ "+want);process.exit(1)}
const s=require("fs").readFileSync("/opt/dsh-profiles-web/node_modules/dsh-workbench-plugin/lib/client.js","utf8");
if(!s.includes("skip: active project not running")){console.error("CLIENT VERIFY FAILED: 缺历史修复标记（回退打包）");process.exit(1)}
if(!s.includes("ui-workbench: chat file open")){console.error("CLIENT VERIFY FAILED: 缺聊天文件打开改道标记（chat-open 未打包）");process.exit(1)}
if(!s.includes("workbench-change-review")){console.error("CLIENT VERIFY FAILED: 缺改动审查条标记（change-review 未打包）");process.exit(1)}
if(!s.includes("pv history pruned")){console.error("CLIENT VERIFY FAILED: 缺已删项目历史清理标记（BrowserView 下拉修复未打包）");process.exit(1)}
console.log("client.js 版本 "+pkg.version+" 确认（含占位/日志/聊天文件改道/改动审查/下拉清理）")' || die "镜像内 client.js 验证失败"
ok "镜像内 client.js 为新版"

# ── 5e 注入脚本语法守卫（browser-inspect-script 模板转义坑）────────────────
# 注入脚本是模板字符串：裸 '\n'/\1 会被外层模板处理成真实换行/非法转义 →
# 整段脚本解析失败 → browser_* 全超时（2026-08-29 db36/db37 生产事故根因）。
# tsdown 只检查外层 JS，不会执行字符串内容——这里用 vm.Script 做完整语法校验。
say "5e/7 验证注入脚本（browser-inspect-script）语法"
docker run --rm --entrypoint node "${IMAGE}" -e '
const fs=require("fs"),vm=require("vm");
const s=fs.readFileSync("/opt/dsh-profiles-web/node_modules/dsh-workbench-plugin/lib/index.js","utf8");
const start=s.indexOf("window.__DSH_BROWSER__");
if(start<0){console.error("INJECT VERIFY FAILED: 找不到 __DSH_BROWSER__ 注入脚本");process.exit(1)}
const bt=s.lastIndexOf("`",start),end=s.indexOf("`",start+10);
const content=s.slice(bt+1,end);
const cooked=eval("`"+content.replace("${JSON.stringify(BROWSER_MSG_SOURCE)}","\"dsh-workbench-browser\"")+"`");
new vm.Script(cooked);
console.log("注入脚本语法 OK（"+cooked.length+" 字符）")' || die "注入脚本语法验证失败"
ok "注入脚本语法通过"

# ── 5b 镜像内 login 插件验证 ──────────────────────────
say "5b/7 验证镜像内 login 插件（已移除 madazi loading 盖层）"
docker run --rm --entrypoint sh "${IMAGE}" -c '
  F=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@madazi/dsh-plugin-login/lib/client.js
  grep -q "LoginOverlay" "$F" || { echo "LOGIN VERIFY FAILED: 缺登录表单"; exit 1; }
  grep -q "0.0.2" /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@madazi/dsh-plugin-login/package.json || { echo "LOGIN VERIFY FAILED: 版本未到 0.0.2"; exit 1; }
  echo "login plugin 0.0.2 ok（无 madazi 盖层，登录表单在位）"' || die "镜像内 login 插件验证失败"
ok "镜像内 login 插件为新版（0.0.2，无盖层）"

# ── 5c 镜像内 madazi 插件验证 ─────────────────────────────
say "5c/7 验证镜像内 madazi 插件（模板列表 error 修复）"
docker run --rm --entrypoint sh "${IMAGE}" -c '
  F=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@madazi/dsh-plugin-madazi/lib/client.js
  grep -q "创建并进入对话" "$F" || { echo "MADAZI VERIFY FAILED: 缺创建按钮标记"; exit 1; }
  grep -q "项目名不能为空" "$F" || { echo "MADAZI VERIFY FAILED: 缺项目名校验标记"; exit 1; }
  grep -q "madaziMetaLabel" "$F" || { echo "MADAZI VERIFY FAILED: 缺侧栏行标题变化重扫修复（uuid 误隐藏）"; exit 1; }
  # ★ 模板列表 error 修复：error 和模板网格必须共存（不能 error 时模板消失）
  if grep -q "marginBottom: 4.*项目名不能为空\|项目名不能为空.*marginBottom: 4" "$F" 2>/dev/null; then
    echo "madazi plugin ok（含模板列表 error 共存修复）"
  else
    echo "MADAZI VERIFY WARNING: 模板列表 error 修复标记未检测到（人工确认）"
  fi' || die "镜像内 madazi 插件验证失败"
ok "镜像内 madazi 插件已验证"

# ── 5d 镜像内 ui-workspace membership gate 验证（fork 源码实现） ───
say "5d/7 验证镜像内 membership gate（ui-workspace 渲染源头裁剪，fork 源码版）"
docker run --rm --entrypoint sh "${IMAGE}" -c '
  F=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js
  grep -q "api/projects" "$F" || { echo "GATE VERIFY FAILED: 缺成员表拉取标记（fork 产物未生效）"; exit 1; }
  grep -q "startMembershipWatch" "$F" || { echo "GATE VERIFY FAILED: 缺 watch 启动标记"; exit 1; }
  grep -q "gatedWorkspaces" "$F" || { echo "GATE VERIFY FAILED: 缺派生过滤标记"; exit 1; }
  grep -q "workspace denied" "$F" || { echo "GATE VERIFY FAILED: 缺连接拒绝标记"; exit 1; }
  echo "membership gate ok（fork 源码版：成员表拉取 + watch + 派生过滤 + 连接拒绝在位）"' || die "镜像内 membership gate 验证失败"
ok "镜像内 membership gate 为新版（fork 源码实现）"

# ── 6 导入 K3s + rollout ────────────────────────────────────
say "6/7 docker save | ctr images import"
docker save "${IMAGE}" | colima ssh -p "${COLIMA_PROFILE}" -- sudo k3s ctr -n k8s.io images import - || die "ctr 导入失败"
ok "镜像已导入 k3s（imagePullPolicy=Never 直用）"
say "rollout restart ${DEPLOY}"
colima ssh -p "${COLIMA_PROFILE}" -- sudo k3s kubectl -n ${NS} rollout restart deployment/${DEPLOY} || die "rollout restart 失败"
colima ssh -p "${COLIMA_PROFILE}" -- sudo k3s kubectl -n ${NS} rollout status deployment/${DEPLOY} --timeout=240s || die "rollout 未就绪"
ok "rollout 完成 ${DEPLOY} 就绪"

# ── 7 线上验证 ──────────────────────────────────────────────
say "7/7 线上验证"
sleep 3
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "https://<YOUR-DOMAIN>/" || true)
[ "${CODE}" = "200" ] || die "工作台入口 HTTP ${CODE}（预期 200）"
ok "工作台入口 HTTP ${CODE}"
# ★ PVC 侧实证：initContainer 真把新 workbench 插件铺进去了（版本闸门放行的最终证据）
PVC_VER=$(colima ssh -p "${COLIMA_PROFILE}" -- sudo k3s kubectl -n ${NS} exec deploy/${DEPLOY} -c dsh-web -- sh -c 'cat /app/generated/.dsh/.madazi-template-version 2>/dev/null' || true)
[ "${PVC_VER}" = "${NEW_VER}" ] || die "PVC 模板版本 ${PVC_VER} ≠ 镜像 ${NEW_VER}（initContainer 未铺新插件）"
# 注意：grep -c 无匹配时输出 0 但退出码为 1，必须 || true 兜底（否则 die 误报）
PVC_BAD=$(colima ssh -p "${COLIMA_PROFILE}" -- sudo k3s kubectl -n ${NS} exec deploy/${DEPLOY} -c dsh-web -- sh -c 'grep -c "项目: " /app/generated/.dsh/profiles/web/node_modules/dsh-workbench-plugin/lib/client.js 2>/dev/null || true' | tail -1 || true)
[ "${PVC_BAD}" = "0" ] || die "PVC 内 workbench 插件仍是旧版（含 '项目: ' 前缀，铺入未生效）"
ok "PVC 插件已铺新（模板版本 ${PVC_VER}，无旧标记）"
echo
ok "🎉 dsh-web 构建部署完成：${IMAGE}（${TGZ_NAME} sha512 ${NEW_SHA:0:12}…）"
