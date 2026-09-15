#!/bin/bash
# 预览容器统一入口脚本（方案C，K8s 模式）
# 职责：构建段（依赖安装+配置生成）-> 调 start.sh（启动段，可单独重跑）
# 拆分目的：软重启（restart-app）只重跑启动段，秒级恢复；构建段一次完成
# 代理配置（HMR/VITE_BASE）在此固定处理，AI 不碰
set -e

DATA_DIR="/data/$PROJECT_DIR"

# ★ pnpm-first 依赖安装（pnpm 硬链接共享 store，二次安装秒级）
#   有 lock 用 frozen（严格快），无 lock 用 --no-frozen-lockfile，pnpm 缺失回退 npm
#   store 放 PVC /data/.pnpm-store，所有项目 Pod 共享依赖缓存
#   npm fallback 的 cache 同样放 PVC（Maven 共享缓存在 settings.xml localRepository）
export npm_config_store_dir="/data/.pnpm-store"
export npm_config_cache="/data/.npm-cache"

# ★ Go 共享缓存：module cache 放 PVC（默认 /root/go 在容器层，pod 删除即丢）
#   GOPROXY 必须显式配置（默认 proxy.golang.org 国内不可达）
export GOPATH="/data/.go"
export GOMODCACHE="/data/.go/pkg/mod"
export GOCACHE="/data/.go/build-cache"
export GOPROXY="https://goproxy.cn,direct"
node_install() {
  cd "$1" || return 1
  if command -v pnpm >/dev/null 2>&1; then
    if [ -f pnpm-lock.yaml ]; then
      echo "[preview] [deps] pnpm install (frozen, lock 命中)"
      pnpm install --frozen-lockfile --reporter=append-only --registry=https://registry.npmmirror.com 2>&1
    else
      echo "[preview] [deps] pnpm install (无 lock)"
      pnpm install --no-frozen-lockfile --reporter=append-only --registry=https://registry.npmmirror.com 2>&1
    fi
  else
    echo "[preview] [deps] pnpm 不可用，回退 npm install"
    npm install --registry=https://registry.npmmirror.com 2>&1
  fi
}

echo "[preview] ==========================================="
echo "[preview] 项目目录: $DATA_DIR"
echo "[preview] PROJECT_ID=$PROJECT_ID HAS_BACKEND=$HAS_BACKEND HAS_FRONTEND=$HAS_FRONTEND"
echo "[preview] ==========================================="

# ★ 导入项目桥接层：存在 .preview-config.json（preview.js 规则生成；启动不对可在对话中让 AI 修正）
#   → workdir 重定向 + 配置化安装命令；模板项目无此文件，行为完全不变
CFG_FILE="$DATA_DIR/.preview-config.json"
CFG_MODE=0
CFG_WORKDIR=""
CFG_INSTALL=""
if [ -f "$CFG_FILE" ]; then
  CFG_MODE=1
  # 无 jq（alpine 精简），node 解析并输出单引号转义的 bash 安全赋值
  eval "$(node -e '
    const c = require(process.argv[1]);
    const q = (s) => "\x27" + String(s == null ? "" : s).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    console.log("CFG_WORKDIR=" + q(c.workdir));
    console.log("CFG_INSTALL=" + q(c.install_cmd));
  ' "$CFG_FILE")"
  echo "[preview] 导入项目模式：按 .preview-config.json（workdir=${CFG_WORKDIR:-.}）"
fi

# 前端目录：模板布局=frontend/ 子目录；导入项目=配置 workdir（缺省项目根）
# ★ workdir 必须存在——旧 AI 配置可能写绝对路径/已失效目录，兜底回项目根（否则 heredoc 写文件即崩）
resolve_workdir() {
  local d
  case "$CFG_WORKDIR" in
    /*) d="$CFG_WORKDIR" ;;
    "")  d="$DATA_DIR" ;;
    *)   d="$DATA_DIR/$CFG_WORKDIR" ;;
  esac
  if [ -d "$d" ]; then
    echo "$d"
  else
    echo "[preview] WARN: workdir 不存在（$d），回退项目根 $DATA_DIR" >&2
    echo "$DATA_DIR"
  fi
}

# ============ 构建段 A：前端依赖 + 代理配置 ============
if [ "$HAS_FRONTEND" = "1" ]; then
  echo "=== [build] 前端依赖安装 + 代理配置 ==="
  if [ "$CFG_MODE" = "1" ]; then
    FE_DIR="$(resolve_workdir)"
    echo "[preview] [导入] 前端目录: $FE_DIR"
  else
    FE_DIR="$DATA_DIR/frontend"
  fi

  # 检测前端框架
  FE_FRAMEWORK="react"
  if grep -q '"vue"' "$FE_DIR/package.json" 2>/dev/null; then
    if grep -q '"@dcloudio/uni-app"' "$FE_DIR/package.json" 2>/dev/null; then
      FE_FRAMEWORK="uniapp"
    else
      FE_FRAMEWORK="vue"
    fi
  fi

  # 兜底：仅当项目完全没有 vite.config 时生成（注入方案已解决环境变量问题，
  # 不再因"不支持环境变量"覆盖项目自带配置——那是破坏性的）
  NEED_GEN=0
  if [ ! -f "$FE_DIR/vite.config.js" ] && [ ! -f "$FE_DIR/vite.config.ts" ]; then
    NEED_GEN=1
  fi
  VITE_CFG="$FE_DIR/vite.config.js"
  [ -f "$VITE_CFG" ] || VITE_CFG="$FE_DIR/vite.config.ts"

  # 清理遗留兜底：项目有 .js 时，含注入标识（VITE_HMR_HOST）的 .ts 是历史兜底产物，
  # Vite 虽不加载它（.js 优先）但留着易混淆——删掉
  if [ -f "$FE_DIR/vite.config.js" ] && [ -f "$FE_DIR/vite.config.ts" ] \
     && grep -q 'VITE_HMR_HOST' "$FE_DIR/vite.config.ts" 2>/dev/null; then
    rm -f "$FE_DIR/vite.config.ts" "${FE_DIR}/vite.config.ts.madazi-orig"
    echo "[preview] 已清理历史兜底 vite.config.ts"
  fi

  if [ "$NEED_GEN" = "1" ]; then
    if [ "$FE_FRAMEWORK" = "vue" ] || [ "$FE_FRAMEWORK" = "uniapp" ]; then
      cat > "$FE_DIR/vite.config.ts" << 'VITEEOF'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const BASE = process.env.VITE_BASE || '/'
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:8080'

export default defineConfig({
  plugins: [vue()],
  base: BASE === '/' ? '/' : BASE + '/',
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: process.env.VITE_HMR_HOST ? { protocol: 'wss', host: process.env.VITE_HMR_HOST, clientPort: 443 } : (process.env.HMR_CLIENT_PORT ? { clientPort: Number(process.env.HMR_CLIENT_PORT) } : false),
    proxy: process.env.VITE_BE_URL ? {
      '/api': { target: BE_URL, changeOrigin: true },
    } : undefined,
  },
})
VITEEOF
    else
      cat > "$FE_DIR/vite.config.ts" << 'VITEEOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BASE = process.env.VITE_BASE || '/'
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  base: BASE === '/' ? '/' : BASE + '/',
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: process.env.VITE_HMR_HOST ? { protocol: 'wss', host: process.env.VITE_HMR_HOST, clientPort: 443 } : (process.env.HMR_CLIENT_PORT ? { clientPort: Number(process.env.HMR_CLIENT_PORT) } : false),
    proxy: process.env.VITE_BE_URL ? {
      '/api': { target: BE_URL, changeOrigin: true },
    } : undefined,
  },
})
VITEEOF
    fi
    echo "[preview] vite.config.ts generated (fallback)"
  else
    echo "[preview] vite.config 使用项目自带配置"
  fi

  # ★ vite.config 注入（幂等 + 自愈版）
  #   设计要点（血泪教训）：
  #   a. PVC 持久化文件被多轮构建反复注入 → 必须先清理历史注入痕迹再注入
  #   b. 旧注入只替换正则匹配的前半段，尾巴残留 → 语法错误 → vite 起不来
  #   c. orig 备份必须在"清理后"做（PVC 上可能已是坏文件，回滚不能滚回坏版本）
  #   d. 每次写盘后语法校验，失败回滚（vite 能跑 > HMR 生效）
  VITE_CFG="$FE_DIR/vite.config.js"
  [ -f "$VITE_CFG" ] || VITE_CFG="$FE_DIR/vite.config.ts"
  echo "[preview] VITE_CFG=$VITE_CFG exists=$([ -f "$VITE_CFG" ] && echo yes || echo no)"
  if [ -f "$VITE_CFG" ]; then
    # ---- 第 1 步：清理历史注入痕迹（自愈 PVC 污染 + 保证幂等）----
    node -e '
const fs = require("fs");
const f = process.argv[1];
let s = fs.readFileSync(f, "utf8");
let cleaned = 0;
const before = s;
// 完整注入表达式（env-based hmr：wss | clientPort 三元 | false | 旧 undefined，任意中间内容到结尾）
	s = s.replace(/hmr\s*:\s*process\.env\.VITE_HMR_HOST[\s\S]{0,320}?\}\s*:\s*(?:\(process\.env\.HMR_CLIENT_PORT[\s\S]{0,120}?:\s*false\)|false|undefined),?/g, () => { cleaned++; return ""; });
// 残段（旧正则截断留下的尾巴）
s = s.replace(/host:\s*process\.env\.VITE_HMR_HOST,\s*port:\s*443,\s*clientPort:\s*443\s*\}\s*:\s*undefined,?/g, () => { cleaned++; return ""; });
// sed 时代 hmr: false 残留
s = s.replace(/,?\s*hmr\s*:\s*false\b,?/g, () => { cleaned++; return " "; });
// 注入过的 allowedHosts（server: { 紧邻位置）—— 回调里捕获组必须用参数，"$1" 是字面量
s = s.replace(/(server\s*:\s*\{)\s*allowedHosts:\s*true,?/g, (m, g1) => { cleaned++; return g1; });
fs.writeFileSync(f, s);
console.log(cleaned ? `[preview] 清理历史注入痕迹 x${cleaned}` : "[preview] 无历史注入痕迹");
' "$VITE_CFG" 2>&1 || echo "[preview] WARN: cleanup failed"

    # ---- 第 2 步：语法校验函数（依赖未装/CJS-ESM 差异可接受；真语法错误 BAD）----
    syntax_check() {
      node -e "
import(\x27file://\x27 + process.argv[1]).then(
  () => console.log(\x27SYNTAX-OK\x27),
  (e) => {
    const msg = String(e.message || e);
    const bad = /Expected|Unexpected token|invalid token/i.test(msg) && !/import statement/i.test(msg);
    console.log(bad ? \x27SYNTAX-BAD: \x27 + msg.slice(0, 120) : \x27SYNTAX-OK (acceptable): \x27 + msg.slice(0, 80));
  });
" "$1" 2>&1 | grep -o "SYNTAX-BAD.*" || true
    }

    # 清理版校验：清理后若仍坏（项目配置本身损坏），跳过注入避免火上浇油
    CLEAN_ERR=$(syntax_check "$VITE_CFG")
    if [ -n "$CLEAN_ERR" ]; then
      echo "[preview] ⚠️ 清理后仍语法异常（项目自带配置问题）：$CLEAN_ERR — 跳过注入"
    else
      # ---- 第 3 步：备份清理版 + 注入 ----
      cp "$VITE_CFG" "${VITE_CFG}.madazi-orig"
      node -e '
const fs = require("fs");
const f = process.argv[1];
let s = fs.readFileSync(f, "utf8");
// ★ 只用 clientPort（纯客户端连接提示）。port 是「独立 HMR ws server 的监听端口」——
//   一旦设置且 ≠ server.port，vite 会在主 server 上【不注册 upgrade 监听】，
//   所有 WS 升级挂起无人处理（vite 6.4 createWebSocketServer 的 portsAreCompatible 逻辑）
// ★ HMR 三态（2026-09-13）：
//   · VITE_HMR_HOST（k8s pv 子域）→ wss
//   · HMR_CLIENT_PORT（单机 docker，preview-docker.js 传对外 hostPort）→ hmr: { clientPort }
//     vite 端口兼容：clientPort ≠ server.port 时仍在主 server 注册 upgrade，客户端连
//     ws://127.0.0.1:<hostPort>（docker 端口映射转发）→ WS 握手成功，HMR 可用
//   · 都没有 → hmr: false（显式关闭；undefined 会让 vite 默认开 HMR 连内网端口失败）
	const HMR = "hmr: process.env.VITE_HMR_HOST ? { protocol: \x27wss\x27, host: process.env.VITE_HMR_HOST, clientPort: 443 } : (process.env.HMR_CLIENT_PORT ? { clientPort: Number(process.env.HMR_CLIENT_PORT) } : false)";
// ★ base 兼容（2026-09-01 短 URL 迁移）：旧模板 base: BASE + "/" 在 BASE="/" 时产出
//   "//"（错误）。统一改为正确处理 "/"：BASE="/" 时 "/"，否则 BASE + "/"。
s = s.replace(/base:\s*BASE\s*\+\s*[\x27"]\/[\x27"]/, "base: (BASE === \x27/\x27 ? \x27/\x27 : BASE + \x27/\x27)");
// ★ rewrite 兼容：旧模板 rewrite: (p) => p.replace(BASE, "") 在 BASE="/" 时会剥掉 /api 前缀
//   （/api/xxx → api/xxx，后端 404）。BASE="/" 时禁用 rewrite（原样转发 /api/xxx → 后端）。
s = s.replace(/rewrite:\s*\(p\)\s*=>\s*p\.replace\(BASE,\s*[\x27"]{0,1}[\x27"]\)/, "rewrite: (BASE === \x27/\x27 ? undefined : (p) => p.replace(BASE, \x27\x27))");
if (/(server\s*:\s*\{)/.test(s)) {
  s = s.replace(/(server\s*:\s*\{)/, "$1 " + HMR + ", allowedHosts: true,");
  fs.writeFileSync(f, s);
  console.log("[preview] hmr + allowedHosts + base-compat injected");
} else {
  console.log("[preview] WARN: 未找到 server: { 注入点，跳过注入");
}
' "$VITE_CFG" 2>&1 || echo "[preview] WARN: inject failed"

      # ---- 第 4 步：注入版校验，失败回滚到清理版（vite 可跑，仅 HMR 缺失）----
      INJ_ERR=$(syntax_check "$VITE_CFG")
      if [ -n "$INJ_ERR" ]; then
        echo "[preview] ⚠️ 注入后语法校验失败：$INJ_ERR"
        echo "[preview] 回滚到清理版配置（HMR/allowedHosts 不生效，但 vite 可启动）"
        cp "${VITE_CFG}.madazi-orig" "$VITE_CFG"
      else
        echo "[preview] vite.config 注入完成，语法校验通过"
      fi
    fi
  fi

  # 前端依赖安装（一次构建，软重启不重装）
  echo "[preview] [前端] 安装依赖中..."
  if [ "$CFG_MODE" = "1" ] && [ -n "$CFG_INSTALL" ]; then
    echo "[preview] [导入] 按配置安装: $CFG_INSTALL"
    ( cd "$FE_DIR" && sh -c "$CFG_INSTALL" ) 2>&1 | tail -20
  else
    node_install "$FE_DIR"
  fi
fi

# ============ 构建段 B：后端依赖安装 + 编译 ============
# 导入项目（CFG_MODE=1）的后端由 start.sh 的 backend_cmd 全权负责，此处跳过
if [ "$HAS_BACKEND" = "1" ] && [ "$CFG_MODE" != "1" ]; then
  echo "=== [build] 后端依赖安装 + 编译 ==="
  BACKEND_START="$DATA_DIR/backend-start.sh"
  if [ -f "$BACKEND_START" ]; then
    # AI 生成的 backend-start.sh 构建+启动一体，构建段不动它（start.sh 里整跑）
    echo "[preview] 存在 AI 生成 backend-start.sh（构建+启动一体，交由 start.sh 执行）"
  else
    BE_DIR="$DATA_DIR/backend"

    if [ -f "$BE_DIR/pom.xml" ]; then
      echo "[preview] [后端] Spring Boot 项目（javax -> jakarta 迁移）"
      find "$BE_DIR/src/main/java" -name "*.java" -exec sed -i \
        -e 's/javax\.persistence/jakarta.persistence/g' \
        -e 's/javax\.servlet/jakarta.servlet/g' \
        -e 's/javax\.validation/jakarta.validation/g' \
        {} + 2>/dev/null || true

    elif [ -f "$BE_DIR/package.json" ]; then
      echo "[preview] [后端] Node.js 项目（依赖安装）"
      node_install "$BE_DIR"
      cd "$BE_DIR"
      # ★ tsc 缺失（pnpm frozen lock 未锁 devDeps 的 typescript）→ 显式补装再编译
      if [ ! -x node_modules/.bin/tsc ]; then
        echo "[preview] [后端] typescript 未安装（lock 未锁 devDeps），补装 devDeps..."
        pnpm install --no-frozen-lockfile --include=dev --registry=https://registry.npmmirror.com 2>&1 | tail -5
      fi
      if [ -x node_modules/.bin/tsc ]; then
        node_modules/.bin/tsc 2>&1 || true
      else
        echo "[preview] [后端] WARN: tsc 仍不可用，跳过 TS 编译（后端按 start 脚本兜底）"
      fi

    elif [ -f "$BE_DIR/go.mod" ]; then
      echo "[preview] [后端] Go 项目（依赖补全 + 编译）"
      cd "$BE_DIR"
      # GOPROXY/GOPATH/GOMODCACHE/GOCACHE 已在顶部统一指向 PVC 共享缓存（/data/.go），此处不再覆盖
      export GOTMPDIR=/root/.cache/gotmp
      mkdir -p "$GOTMPDIR"
      echo "[preview] [后端] 补全 Go 依赖 (go mod tidy)..."
      go mod tidy 2>&1 | tail -5
      echo "[preview] [后端] 编译 Go 项目..."
      CGO_ENABLED=0 go build -ldflags="-s -w" -o server . 2>&1 | tail -10 || {
        echo "[preview] [后端] 编译失败（go build），start.sh 将尝试 go run"
        touch /tmp/go-build-failed
      }

    elif [ -f "$BE_DIR/requirements.txt" ] || [ -f "$BE_DIR/pyproject.toml" ]; then
      echo "[preview] [后端] Python 项目（依赖安装）"
      cd "$BE_DIR"
      if [ -f requirements.txt ]; then
        pip install --no-cache-dir --break-system-packages -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt 2>&1 | tail -10
      elif [ -f pyproject.toml ]; then
        pip install --no-cache-dir --break-system-packages -i https://mirrors.aliyun.com/pypi/simple/ . 2>&1 | tail -10
      fi
    fi
  fi
fi

echo "[preview] ========== 构建段完成，进入启动段 =========="
# 前台调用 start.sh（内部服务全后台化 + tail 保活，容器不退出）
bash /app/start.sh
