#!/bin/bash
# 预览容器统一入口脚本（方案C）
# 职责：启动DB -> source 项目 backend-start.sh -> 启动前端 Vite
# 代理配置（HMR/VITE_BASE）在此固定处理，AI 不碰
set -e

DATA_DIR="/data/$PROJECT_DIR"

echo "[preview] ==========================================="
echo "[preview] 项目目录: $DATA_DIR"
echo "[preview] PROJECT_ID=$PROJECT_ID HAS_BACKEND=$HAS_BACKEND HAS_FRONTEND=$HAS_FRONTEND"
echo "[preview] ==========================================="

# ============ 1. 启动 PostgreSQL ============
echo "=== [1/4] Starting PostgreSQL ==="
PG_DATA="/var/lib/postgresql/data"
PG_RUN="/run/postgresql"

if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  echo "[preview] [postgres] Initializing database cluster..."
  chown -R postgres:postgres "$PG_DATA" "$PG_RUN"
  su postgres -c "initdb -D $PG_DATA --auth=trust --encoding=UTF8"
  echo "listen_addresses = 'localhost'" >> "$PG_DATA/postgresql.conf"
  echo "unix_socket_directories = '/run/postgresql'" >> "$PG_DATA/postgresql.conf"
fi

# ★ 确保 listen_addresses 为 localhost（修复历史遗留的空值导致 TCP 5432 不可达）
if grep -q "^listen_addresses = ''" "$PG_DATA/postgresql.conf" 2>/dev/null; then
  sed -i "s/^listen_addresses = ''/listen_addresses = 'localhost'/" "$PG_DATA/postgresql.conf"
  echo "[preview] [postgres] Fixed listen_addresses: '' -> 'localhost'"
fi

chown -R postgres:postgres "$PG_DATA" "$PG_RUN"

# 清理 stale PID 文件（容器非正常停止时残留）
if [ -f "$PG_DATA/postmaster.pid" ]; then
  echo "[preview] [postgres] Cleaning stale postmaster.pid"
  rm -f "$PG_DATA/postmaster.pid"
fi

su postgres -c "pg_ctl -D $PG_DATA -l /tmp/postgres.log start -w"
sleep 1

su postgres -c "psql -c \"CREATE DATABASE appdb;\"" 2>/dev/null || echo "[preview] [postgres] database appdb already exists"
su postgres -c "psql -c \"CREATE EXTENSION IF NOT EXISTS pgcrypto;\" -d appdb" 2>/dev/null || true
echo "[preview] [postgres] Ready on localhost:5432 (db=appdb)"

# ============ 2. 前端代理配置 ============
if [ "$HAS_FRONTEND" = "1" ]; then
  echo "=== [2/4] Configuring frontend proxy ==="
  FE_DIR="$DATA_DIR/frontend"

  # ★ 子域名模式：VITE_BASE 留空，项目 vite.config 的 `process.env.VITE_BASE || '/'` 走默认 '/'
  # 不能设 '/'，否则项目自带 config 的 `base: BASE + '/'` = '//' 导致 Vite Invalid URL
  export VITE_BASE=""
  if [ "$HAS_BACKEND" = "1" ]; then
    if [ -f "$DATA_DIR/backend/package.json" ]; then
      export VITE_BE_URL="http://localhost:3001"
    elif [ -f "$DATA_DIR/backend/go.mod" ]; then
      export VITE_BE_URL="http://localhost:3000"
    else
      export VITE_BE_URL="http://localhost:8080"
    fi
  fi
  echo "[preview] VITE_BASE=$VITE_BASE VITE_BE_URL=$VITE_BE_URL"

  # 检测前端框架
  FE_FRAMEWORK="react"
  if grep -q '"vue"' "$FE_DIR/package.json" 2>/dev/null; then
    if grep -q '"@dcloudio/uni-app"' "$FE_DIR/package.json" 2>/dev/null; then
      FE_FRAMEWORK="uniapp"
    else
      FE_FRAMEWORK="vue"
    fi
  fi

  # 兜底：检测项目 vite.config 是否支持环境变量，不支持则生成
  VITE_CFG="$FE_DIR/vite.config.js"
  [ -f "$VITE_CFG" ] || VITE_CFG="$FE_DIR/vite.config.ts"
  NEED_GEN=0
  if [ ! -f "$VITE_CFG" ]; then
    NEED_GEN=1
  elif ! grep -q 'VITE_BASE\|VITE_BE_URL' "$VITE_CFG" 2>/dev/null; then
    NEED_GEN=1
    echo "[preview] vite.config 不支持环境变量，生成兜底配置"
  fi

  if [ "$NEED_GEN" = "1" ]; then
    if [ "$FE_FRAMEWORK" = "vue" ] || [ "$FE_FRAMEWORK" = "uniapp" ]; then
      cat > "$FE_DIR/vite.config.ts" << 'VITEEOF'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const BASE = (process.env.VITE_BASE || '/').replace(/\/$/, '') || '/'
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:8080'

export default defineConfig({
  plugins: [vue()],
  base: BASE,
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    proxy: process.env.VITE_BE_URL ? {
      '/api': {
        target: BE_URL,
        changeOrigin: true,
        rewrite: (p) => p.replace(BASE, ''),
      },
    } : undefined,
  },
})
VITEEOF
    else
      cat > "$FE_DIR/vite.config.ts" << 'VITEEOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BASE = (process.env.VITE_BASE || '/').replace(/\/$/, '') || '/'
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  base: BASE,
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    proxy: process.env.VITE_BE_URL ? {
      '/api': {
        target: BE_URL,
        changeOrigin: true,
        rewrite: (p) => p.replace(BASE, ''),
      },
    } : undefined,
  },
})
VITEEOF
    fi
    echo "[preview] vite.config.ts generated (fallback)"
  else
    echo "[preview] vite.config 使用项目自带配置"
  fi

  # 强制禁用 HMR + 允许所有 host（Vite 6 allowedHosts）
  # 优先检测 .js（用户项目原始文件），再检测 .ts
  VITE_CFG="$FE_DIR/vite.config.js"
  [ -f "$VITE_CFG" ] || VITE_CFG="$FE_DIR/vite.config.ts"
  echo "[preview] VITE_CFG=$VITE_CFG exists=$([ -f "$VITE_CFG" ] && echo yes || echo no)"
  if [ -f "$VITE_CFG" ]; then
    if ! grep -q 'hmr.*false' "$VITE_CFG" 2>/dev/null; then
      # 在 server: { 后面插入 hmr: false（用 awk 处理嵌套大括号）
      sed -i '/server: {/a\    hmr: false,' "$VITE_CFG"
      echo "[preview] 已注入 hmr: false 到 $VITE_CFG"
    fi
    if ! grep -q 'allowedHosts' "$VITE_CFG" 2>/dev/null; then
      # 在 server: { 后面插入 allowedHosts: true
      sed -i '/server: {/a\    allowedHosts: true,' "$VITE_CFG"
      echo "[preview] 已注入 allowedHosts: true 到 $VITE_CFG"
    else
      echo "[preview] allowedHosts 已存在，跳过"
    fi
    # ★ 修复 base 拼接：项目 vite.config 常见 `base: BASE + '/'`
    # 当 VITE_BASE 留空时 BASE='/'，`'/' + '/'` = '//' 导致 Vite Invalid URL
    # 统一替换为 `base: BASE`（去掉多余的 + '/'）
    if grep -q "base:.*BASE.*+.*'/'" "$VITE_CFG" 2>/dev/null; then
      sed -i "s/base:\s*BASE\s*+\s*'\/'/base: BASE/g" "$VITE_CFG"
      echo "[preview] 已修复 base 拼接（去掉 + '/'）"
    fi
  fi

  # ★ 子域名模式下 router basename 固定为 /（不再需要子目录前缀）
  # 如果项目代码里已有旧 basename（子目录方案遗留），替换为 /
  echo "[preview] [router] Setting basename='/'"

  # React Router: <BrowserRouter> -> <BrowserRouter basename="/">
  # 替换已存在的旧 basename，或注入新的
  for f in "$FE_DIR/src/main.tsx" "$FE_DIR/src/main.jsx" "$FE_DIR/src/index.tsx" "$FE_DIR/src/index.jsx" "$FE_DIR/src/App.tsx" "$FE_DIR/src/App.jsx"; do
    if [ ! -f "$f" ]; then continue; fi
    if grep -q 'BrowserRouter' "$f" 2>/dev/null; then
      if grep -q 'basename=' "$f" 2>/dev/null; then
        # 替换已存在的旧 basename（任意值）为 /
        sed -i 's|<BrowserRouter[^>]*basename="[^"]*"|<BrowserRouter basename="/"|g' "$f"
        echo "[preview] [router] Replaced basename to '/' in $f"
      else
        sed -i 's|<BrowserRouter|<BrowserRouter basename="/"|g' "$f"
        echo "[preview] [router] Injected basename='/' into $f"
      fi
    elif grep -q 'createBrowserRouter' "$f" 2>/dev/null; then
      if grep -q 'basename' "$f" 2>/dev/null; then
        sed -i 's|basename:\s*"[^"]*"|basename: "/"|g' "$f"
        echo "[preview] [router] Replaced basename to '/' in $f"
      fi
    fi
  done

  # ★ 修复 API 绝对路径：预览环境中 /api 需要加 VITE_BASE 前缀
  # 常见模式: const API_BASE = '/api'  ->  const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api'
  API_TS=""
  for f in "$FE_DIR/src/api.ts" "$FE_DIR/src/api.js" "$FE_DIR/src/lib/api.ts" "$FE_DIR/src/utils/api.ts" "$FE_DIR/src/services/api.ts"; do
    if [ -f "$f" ]; then API_TS="$f"; break; fi
  done
  if [ -n "$API_TS" ]; then
    if grep -q "API_BASE.*=.*'/api'" "$API_TS" 2>/dev/null && ! grep -q 'import.meta.env.BASE_URL' "$API_TS" 2>/dev/null; then
      sed -i "s|const API_BASE = '/api'|const API_BASE = import.meta.env.BASE_URL.replace(/\\\\\/\$/, '') + '/api'|" "$API_TS"
      echo "[preview] [api] Fixed API_BASE to use BASE_URL ($API_TS)"
    fi
  fi

  # Vue Router: createRouter({ history: createWebHistory() }) -> createWebHistory("/")
  for f in "$FE_DIR/src/main.ts" "$FE_DIR/src/main.js"; do
    if [ -f "$f" ] && grep -q 'createWebHistory' "$f" 2>/dev/null && ! grep -q 'basename\|VITE_BASE' "$f" 2>/dev/null; then
      sed -i 's|createWebHistory()|createWebHistory("/")|g' "$f"
      echo "[preview] [router] Injected basename='/' into Vue Router ($f)"
    fi
  done
fi

# ============ 3. 启动后端 ============
echo "=== [3/4] Starting backend ==="
if [ "$HAS_BACKEND" = "1" ]; then
  BACKEND_START="$DATA_DIR/backend-start.sh"
  if [ -f "$BACKEND_START" ]; then
    echo "[preview] Using AI-generated backend-start.sh"
    set +e
    bash "$BACKEND_START"
    BACKEND_EXIT=$?
    set -e
    if [ $BACKEND_EXIT -ne 0 ]; then
      echo "[preview] ⚠️ backend-start.sh failed (exit=$BACKEND_EXIT), backend will be unavailable"
    fi
  else
    echo "[preview] No backend-start.sh, using built-in backend logic"
    BE_DIR="$DATA_DIR/backend"

    if [ -f "$BE_DIR/pom.xml" ]; then
      echo "[preview] [后端] Spring Boot 项目"
      # javax -> jakarta
      find "$BE_DIR/src/main/java" -name "*.java" -exec sed -i \
        -e 's/javax\.persistence/jakarta.persistence/g' \
        -e 's/javax\.servlet/jakarta.servlet/g' \
        -e 's/javax\.validation/jakarta.validation/g' \
        {} + 2>/dev/null || true

      cd "$BE_DIR"
      mvn spring-boot:run -DskipTests &
      BE_PID=$!
      echo "[preview] [后端] 等待 Spring Boot 就绪..."
      set +e
      for i in $(seq 1 120); do
        CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/auth/login 2>/dev/null)
        if [ "$CODE" != "000" ] && [ -n "$CODE" ]; then
          echo "[preview] [后端] Spring Boot 就绪! (HTTP $CODE)"
          break
        fi
        if ! kill -0 $BE_PID 2>/dev/null; then
          echo "[preview] [后端] ERROR: Spring Boot 进程退出"
          break
        fi
        sleep 3
      done
      set -e

    elif [ -f "$BE_DIR/package.json" ]; then
      echo "[preview] [后端] Node.js 项目"
      cd "$BE_DIR"
      if command -v pnpm &>/dev/null; then
        pnpm install --registry=https://registry.npmmirror.com 2>&1 | tail -5 || npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5
      else
        npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5
      fi
      npx tsc 2>&1 | tail -5 || true
      npm start &
      BE_PID=$!
      sleep 3
      echo "[preview] [后端] Node.js 服务已启动"

    elif [ -f "$BE_DIR/go.mod" ]; then
      echo "[preview] [后端] Go 项目"
      cd "$BE_DIR"

      # 启动 MariaDB（如有配置文件模板）
      if [ -f cfg.json.template ] || [ -f cfg.json ]; then
        echo "[preview] [后端] 启动 MariaDB..."
        mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld
        mysqld --user=mysql --datadir=/var/lib/mysql &
        for i in $(seq 1 15); do
          if mysqladmin ping -u root 2>/dev/null | grep -q 'alive'; then
            echo "[preview] [后端] MariaDB 就绪 (${i}s)"
            break
          fi
          sleep 1
        done
        mysql -u root -e "CREATE DATABASE IF NOT EXISTS appdb;" 2>/dev/null || true
        echo "[preview] [后端] MariaDB 就绪"

        # 启动 Redis
        echo "[preview] [后端] 启动 Redis..."
        redis-server --daemonize yes 2>/dev/null || true
        echo "[preview] [后端] Redis 就绪"

        # 处理配置文件
        if [ -f cfg.json.template ]; then
          cp cfg.json.template cfg.json
          sed -i 's|"dsn":\s*"[^"]*"|"dsn": "root:@tcp(127.0.0.1:3306)/appdb?charset=utf8mb4\&parseTime=true\&loc=Local"|g' cfg.json
          sed -i 's|"addr":\s*"[^"]*"|"addr": "127.0.0.1:6379"|g' cfg.json
          sed -i 's|"passwd":\s*"[^"]*"|"passwd": ""|g' cfg.json
          echo "[preview] [后端] cfg.json 已配置（本地 MariaDB + Redis）"
        fi
      fi

      export GOPROXY=https://goproxy.cn,direct
      export GOCACHE=/root/.cache/go-build
      export GOTMPDIR=/root/.cache/gotmp
      mkdir -p "$GOCACHE" "$GOTMPDIR"
      echo "[preview] [后端] 补全 Go 依赖 (go mod tidy)..."
      go mod tidy 2>&1 | tail -5
      echo "[preview] [后端] 编译 Go 项目..."
      CGO_ENABLED=0 go build -ldflags="-s -w" -o server . 2>&1 | tail -10 || {
        echo "[preview] [后端] 编译失败，尝试 go run main.go"
        set +e
        go run main.go &
        BE_PID=$!
        sleep 3
        echo "[preview] [后端] Go 服务已启动 (go run)"
        set -e
      }
      if [ -f server ]; then
        echo "[preview] [后端] 启动 Go 服务..."
        ./server &
        BE_PID=$!
        sleep 3
        echo "[preview] [后端] Go 服务已启动"
      fi

    elif [ -f "$BE_DIR/requirements.txt" ] || [ -f "$BE_DIR/pyproject.toml" ]; then
      echo "[preview] [后端] Python 项目"
      cd "$BE_DIR"

      # 安装依赖
      if [ -f requirements.txt ]; then
        echo "[preview] [后端] 安装 Python 依赖..."
        pip install --no-cache-dir --break-system-packages -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt 2>&1 | tail -10
      elif [ -f pyproject.toml ]; then
        echo "[preview] [后端] 安装 Python 依赖 (pyproject.toml)..."
        pip install --no-cache-dir --break-system-packages -i https://mirrors.aliyun.com/pypi/simple/ . 2>&1 | tail -10
      fi

      # 查找入口文件并启动
      if [ -f app.py ]; then
        echo "[preview] [后端] 启动 python app.py..."
        python app.py &
        BE_PID=$!
        sleep 3
        echo "[preview] [后端] Python 服务已启动"
      elif [ -f main.py ]; then
        echo "[preview] [后端] 启动 python main.py..."
        python main.py &
        BE_PID=$!
        sleep 3
        echo "[preview] [后端] Python 服务已启动"
      elif [ -f manage.py ]; then
        echo "[preview] [后端] 启动 Django (manage.py runserver)..."
        python manage.py migrate 2>&1 | tail -5
        python manage.py runserver 0.0.0.0:3001 &
        BE_PID=$!
        sleep 3
        echo "[preview] [后端] Django 服务已启动"
      else
        echo "[preview] [后端] ⚠️ 未找到入口文件 (app.py/main.py/manage.py)"
      fi
    fi
  fi
fi

# ============ 4. 启动前端 ============
echo "=== [4/4] Starting frontend ==="
if [ "$HAS_FRONTEND" = "1" ]; then
  FE_DIR="$DATA_DIR/frontend"
  echo "[preview] [前端] 安装依赖中..."
  cd "$FE_DIR"
  if command -v pnpm &>/dev/null; then
    pnpm install --registry=https://registry.npmmirror.com 2>&1 | tail -5 || npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5
  else
    npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5
  fi
  echo "[preview] [前端] 启动 Vite dev server (:5173)..."
  exec npx vite --host 0.0.0.0 --port 5173
else
  echo "[preview] 无前端，保持容器运行"
  tail -f /dev/null
fi
