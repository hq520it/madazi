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
  echo "listen_addresses = ''" >> "$PG_DATA/postgresql.conf"
  echo "unix_socket_directories = '/run/postgresql'" >> "$PG_DATA/postgresql.conf"
fi

chown -R postgres:postgres "$PG_DATA" "$PG_RUN"
su postgres -c "pg_ctl -D $PG_DATA -l /tmp/postgres.log start -w"
sleep 1

su postgres -c "psql -c \"CREATE DATABASE appdb;\"" 2>/dev/null || echo "[preview] [postgres] database appdb already exists"
su postgres -c "psql -c \"CREATE EXTENSION IF NOT EXISTS pgcrypto;\" -d appdb" 2>/dev/null || true
echo "[preview] [postgres] Ready on localhost:5432 (db=appdb)"

# ============ 2. 前端代理配置 ============
if [ "$HAS_FRONTEND" = "1" ]; then
  echo "=== [2/4] Configuring frontend proxy ==="
  FE_DIR="$DATA_DIR/frontend"

  # ★ 短 URL 预览：base=/，pv-<id8>.<域> 直接打开应用，资源/API 走根路径
  export VITE_BASE="/"
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
  VITE_CFG="$FE_DIR/vite.config.ts"
  [ -f "$VITE_CFG" ] || VITE_CFG="$FE_DIR/vite.config.js"
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

const BASE = process.env.VITE_BASE || '/'
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:8080'

export default defineConfig({
  plugins: [vue()],
  base: BASE + '/',
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    proxy: process.env.VITE_BE_URL ? {
      [BASE + '/api']: {
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

const BASE = process.env.VITE_BASE || '/'
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  base: BASE + '/',
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    proxy: process.env.VITE_BE_URL ? {
      [BASE + '/api']: {
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

  # 强制禁用 HMR
  VITE_CFG="$FE_DIR/vite.config.ts"
  [ -f "$VITE_CFG" ] || VITE_CFG="$FE_DIR/vite.config.js"
  if [ -f "$VITE_CFG" ] && ! grep -q 'hmr.*false' "$VITE_CFG" 2>/dev/null; then
    sed -i 's/\(server:\s*{\)/\1\n    hmr: false,/' "$VITE_CFG"
    echo "[preview] 已注入 hmr: false 到 $VITE_CFG"
  fi
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
      npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5
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

      # ★ Go 共享缓存：module cache + build cache 放 PVC /data/.go（多项目 Pod 复用）
      export GOPROXY=https://goproxy.cn,direct
      export GOPATH=/data/.go
      export GOMODCACHE=/data/.go/pkg/mod
      export GOCACHE=/data/.go/build-cache
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
    fi
  fi
fi

# ============ 4. 启动前端 ============
echo "=== [4/4] Starting frontend ==="
if [ "$HAS_FRONTEND" = "1" ]; then
  FE_DIR="$DATA_DIR/frontend"
  echo "[preview] [前端] 安装依赖中..."
  cd "$FE_DIR"
  npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5
  echo "[preview] [前端] 启动 Vite dev server (:5173)..."
  exec npx vite --host 0.0.0.0 --port 5173
else
  echo "[preview] 无前端，保持容器运行"
  tail -f /dev/null
fi
