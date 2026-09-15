#!/usr/bin/env bash
# ============================================================
# madazi 单机版 start —— 拉起双进程（免 docker/k8s）
#   dsh web    127.0.0.1:3080（fork 内核 + workbench + madazi 插件）
#   server     127.0.0.1:3456（登录门 + 平台 API + 反代，浏览器入口）
# 用法：bash scripts/standalone/start.sh
# 前置：已跑过 bootstrap.sh；PostgreSQL 已装且建好库（默认见下）
# 环境变量（可覆盖）：
#   DATABASE_URL   默认 postgres://madazi:madazi_dev_2026@localhost:5432/madazi
#   PORT           server 监听端口（默认 3456）
#   DSH_WEB_PORT   默认 3080（dsh web 固定 127.0.0.1）
#   DSH_HOME       默认 ~/.madazi/dsh-home
#   NO_OPEN=1      不自动打开浏览器
# ============================================================
set -euo pipefail
MADAZI="$(cd "$(dirname "$0")/../.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.madazi/dsh-home}"
SERVE_DIR="${MADAZI}/madazi-server"
PORT="${PORT:-3456}"
DSH_WEB_PORT="${DSH_WEB_PORT:-3080}"
DATABASE_URL="${DATABASE_URL:-postgres://madazi:madazi_dev_2026@localhost:5432/madazi}"
export DATABASE_URL

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
PIDS=()

# 跨平台打开浏览器（macOS open / Linux xdg-open）
open_url() {
  if [[ "$(uname)" == "Darwin" ]]; then open "$1";
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1";
  else echo "请在浏览器访问：${1}"; fi
}

cleanup() {
  echo
  say "收尾：停止 server 与 dsh web"
  kill "${PIDS[@]:-}" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

# ── 0 前置检查 ───────────────────────────────────────────
[ -x "$(command -v dsh)" ] || die "dsh CLI 未安装（先跑 bootstrap.sh）"
[ -f "${DSH_HOME}/profiles/web/node_modules/dsh-workbench-plugin/lib/client.js" ] \
  || die "profiles 未铺装（先跑 bootstrap.sh）"
[ -d "${SERVE_DIR}/node_modules" ] \
  || die "madazi-server 依赖未装（先跑 bootstrap.sh：会自动 npm install）"

# ── 1 PostgreSQL 连通检查 ────────────────────────────────
say "1/4 检查 PostgreSQL（${DATABASE_URL%%@*}@…）"
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -q || die "PostgreSQL 未运行。macOS：brew services start postgresql@16；或 Docker：docker run -d --name pg16 -p 5432:5432 -e POSTGRES_PASSWORD=madazi_dev_2026 -e POSTGRES_USER=madazi -e POSTGRES_DB=madazi postgres:16"
fi
# 直连验证库存在（失败给出建库指引）；psql 直查连接串
if command -v psql >/dev/null 2>&1; then
  psql "${DATABASE_URL}" -tAc "SELECT 1" >/dev/null 2>&1 \
    && echo "  PG 连通 OK" \
    || { echo "  PG 不可用：$(psql "${DATABASE_URL}" -tAc 'SELECT 1' 2>&1 | tail -1)"; \
         echo "  建库命令：psql postgres -c \"CREATE ROLE madazi LOGIN PASSWORD 'madazi_dev_2026'; CREATE DATABASE madazi OWNER madazi;\""; \
         echo "  或用 Docker 一条命令起库：docker run -d --name pg16 -p 5432:5432 -e POSTGRES_PASSWORD=madazi_dev_2026 -e POSTGRES_USER=madazi -e POSTGRES_DB=madazi postgres:16"; \
         die "PostgreSQL 预检失败（启动/建库后重试）"; }
fi

# ── 2 拉起 dsh web ──────────────────────────────────────
say "2/4 启动 dsh web（127.0.0.1:${DSH_WEB_PORT}）"
# ★ 服务令牌：server 与 dsh 插件 bridge（node 半）共用同一值——bridge 以服务身份
#   调平台 API（preview/管理 RPC），否则无登录态一律 401（macOS 无 openssl 时用固定回退）
SERVICE_TOKEN="${SERVICE_TOKEN:-$(openssl rand -hex 16 2>/dev/null || echo madazi-dev-service-token-9f3d)}"
export SERVICE_TOKEN
DSH_HOME="${DSH_HOME}" \
MADAZI_API_BASE="http://127.0.0.1:${PORT}" \
MADAZI_SVC_TOKEN="${SERVICE_TOKEN}" \
  dsh web --no-open > /tmp/madazi-dsh.log 2>&1 &
PIDS+=("$!")
echo "  dsh web pid $!，日志 /tmp/madazi-dsh.log"

# 等 dsh web 就绪（探 3080）
for i in $(seq 1 30); do
  curl -sf "http://127.0.0.1:${DSH_WEB_PORT}/" -o /dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:${DSH_WEB_PORT}/" -o /dev/null || die "dsh web 未就绪（看 /tmp/madazi-dsh.log）"

# ── 3 拉起 server ───────────────────────────────────────
DSH_WEB_URL="http://127.0.0.1:${DSH_WEB_PORT}"
say "3/4 启动 server（${PORT}，反代 ${DSH_WEB_URL}）"
# ★ 路径显式注入（不依赖调用目录）：项目根=server 目录下 generated；dsh 数据根=DSH_HOME
# ★ PREVIEW_MODE=docker：单机免 K8s，预览走 Docker 单容器（src/services/preview-docker.js）
DSH_WEB_URL="${DSH_WEB_URL}" \
DATABASE_URL="${DATABASE_URL}" \
PORT="${PORT}" \
PROJECTS_ROOT="${SERVE_DIR}/generated" \
DSH_HOME="${DSH_HOME}" \
PREVIEW_MODE="docker" \
SERVICE_TOKEN="${SERVICE_TOKEN}" \
node "${SERVE_DIR}/src/index.js" > /tmp/madazi-server.log 2>&1 &
PIDS+=("$!")
echo "  server pid $!，日志 /tmp/madazi-server.log"

for i in $(seq 1 30); do
  curl -sf "http://127.0.0.1:${PORT}/api/health" -o /dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:${PORT}/api/health" -o /dev/null || die "server 未就绪（看 /tmp/madazi-server.log）"

# ── 4 打开浏览器 ─────────────────────────────────────────
# 浏览器入口 = server 同源反代 /dsh-web（login 插件按 hostname=localhost 硬编码
# API 基址 localhost:3456；3080 直连会跨域 → 登录取 3456/dsh-web）
say "4/4 就绪 🎉 入口 http://localhost:${PORT}/dsh-web/"
echo "  （server 同源聚合：页面 /dsh-web 反代 dsh web，/api/* 平台 API 直供）"
if [ "${NO_OPEN:-0}" != "1" ]; then
  open_url "http://localhost:${PORT}/dsh-web/"
fi
echo "  Ctrl+C 停止。日志：/tmp/madazi-server.log / /tmp/madazi-dsh.log"

# 保持前台
wait 2>/dev/null || true