#!/bin/bash
# 预览容器启动段（K8s 模式）——软重启可单独重跑（保留 Pod + 环境）
# 职责：幂等启动 PG/MariaDB/Redis -> 后端 -> 前端；写 PID 文件；保活
# 所有服务 nohup 后台化 + 输出重定向 /proc/1/fd/1（容器 stdout，kubectl logs 可见）
# 依赖：entrypoint.sh（构建段）先跑过；环境变量 PROJECT_ID/PROJECT_DIR/HAS_FRONTEND/HAS_BACKEND
set -e

DATA_DIR="/data/$PROJECT_DIR"

# ★ 导入项目桥接层：.preview-config.json → 配置驱动启动（模板项目无此文件，走下方模板逻辑）
#   配置由 preview.js 规则生成；启动方式不对可在对话中让 AI 修正该文件后重启预览
CFG_FILE="$DATA_DIR/.preview-config.json"
if [ -f "$CFG_FILE" ]; then
  echo "[preview] ==========================================="
  echo "[preview] 导入项目模式：按 .preview-config.json 启动"
  echo "[preview] 项目目录: $DATA_DIR"
  echo "[preview] ==========================================="
  # 无 jq（alpine 精简），node 解析并输出单引号转义的 bash 安全赋值
  eval "$(node -e '
    const c = require(process.argv[1]);
    const q = (s) => "\x27" + String(s == null ? "" : s).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    console.log("CFG_WORKDIR=" + q(c.workdir));
    console.log("CFG_BACKEND=" + q(c.backend_cmd));
    console.log("CFG_START=" + q(c.start_cmd));
    const env = c.env && typeof c.env === "object" ? c.env : {};
    for (const k of Object.keys(env)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) console.log("export " + k + "=" + q(env[k]));
    }
  ' "$CFG_FILE")"
  # workdir：绝对路径或相对 DATA_DIR，缺省=项目根
  case "$CFG_WORKDIR" in
    /*) cd "$CFG_WORKDIR" 2>/dev/null || cd "$DATA_DIR" ;;
    "")  cd "$DATA_DIR" ;;
    *)   cd "$DATA_DIR/$CFG_WORKDIR" 2>/dev/null || cd "$DATA_DIR" ;;
  esac
  echo "[preview] workdir: $(pwd)"
  # 前端代理环境（base/HMR）沿用模板机制
  if [ "$HAS_FRONTEND" = "1" ]; then
    # ★ 短 URL 预览（2026-09-01）：base=/，pv-<id8>.<域> 直接打开应用，资源/API 走根路径
    export VITE_BASE="/"
    # ★ HMR host 仅 k8s 用（PREVIEW_DOMAIN 非空 → pv- 子域 wss）；单机 docker 必须留空，
    #   否则 vite 客户端连 wss://pv-<id>.<YOUR-DOMAIN>.com 握手失败（preview-docker.js 注入
    #   HMR_CLIENT_PORT 走 hmr.clientPort，这才是单机正确链路）
    export VITE_HMR_HOST=""
    if [ -n "$PREVIEW_DOMAIN" ]; then
      export VITE_HMR_HOST="pv-${PROJECT_ID:0:8}.${PREVIEW_DOMAIN}"
    fi
    echo "[preview] VITE_BASE=$VITE_BASE VITE_HMR_HOST=$VITE_HMR_HOST"
  fi
  if [ -n "$CFG_BACKEND" ]; then
    echo "[preview] 启动后端（后台）: $CFG_BACKEND"
    set +e
    nohup sh -c "$CFG_BACKEND" > /proc/1/fd/1 2>&1 &
    echo $! > /tmp/madazi-be.pid
    set -e
    echo "[preview] 后端已启动 (pid $(cat /tmp/madazi-be.pid))"
  fi
  if [ -n "$CFG_START" ]; then
    echo "[preview] 启动前端: $CFG_START"
    nohup sh -c "$CFG_START" > /proc/1/fd/1 2>&1 &
    echo $! > /tmp/madazi-fe.pid
    echo "[preview] 前端已启动 (pid $(cat /tmp/madazi-fe.pid))"
  else
    echo "[preview] 无 start_cmd（可在对话中让 AI 生成/修正 .preview-config.json 后重启预览）"
  fi
  # ★ 端口自适应 watcher：CLI --port 并非所有框架都吃得住（项目配置可盖掉 CLI）。
  #   解析 /proc/net/tcp LISTEN 端口，HTTP 探测确认后写入 PVC .preview-port，
  #   server 的探活/代理以它为准；3s 周期，端口漂移自动更新
  rm -f "$DATA_DIR/.preview-port"
  cat > /tmp/madazi-port-watch.js <<'PWEOF'
const fs = require('fs');
const http = require('http');
const OUT = process.argv[2];
const PREFER = parseInt(process.argv[3], 10) || 5173;
const SKIP = new Set([3001, 8080, 5432, 6379, 3306, 8000, 9000]);
function listenPorts() {
  const ports = new Set();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let s; try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of s.split('\n').slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length > 3 && c[3] === '0A') {
        const p = parseInt((c[1] || '').split(':')[1] || '', 16);
        if (p >= 1024) ports.add(p);
      }
    }
  }
  return [...ports];
}
function httpOk(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
let last = 0;
async function tick() {
  const ports = listenPorts();
  const ordered = [PREFER, ...ports.filter(p => p !== PREFER && !SKIP.has(p)).sort((a, b) => a - b)];
  for (const p of ordered) {
    if (!ports.includes(p)) continue;
    if (await httpOk(p)) {
      if (p !== last) {
        try { fs.writeFileSync(OUT, String(p)); } catch {}
        console.log(`[preview] [端口探测] 前端监听端口: ${p}（已写入 .preview-port）`);
        last = p;
      }
      return;
    }
  }
}
setInterval(() => { tick().catch(() => {}); }, 3000);
tick().catch(() => {});
PWEOF
  node /tmp/madazi-port-watch.js "$DATA_DIR/.preview-port" "$CFG_PORT" > /proc/1/fd/1 2>&1 &
  echo "[preview] 端口自适应 watcher 已启动（约定端口 $CFG_PORT 优先）"
  echo "[preview] All services started. Keeping alive."
  tail -f /dev/null
fi

# ============ 1. PostgreSQL（幂等：已启动则跳过）============
echo "=== [1/4] Starting PostgreSQL ==="
# ★ pgdata 放项目目录外的隐藏系统目录 /data/.pgdata/<项目>/（仍在共享 PVC，持久）：
#   文件树根是项目源码目录，看不到 /data/.pgdata，数据库内部文件不再暴露给用户
PG_DATA="/data/.pgdata/$PROJECT_DIR/pgdata"
PG_RUN="/run/postgresql"
mkdir -p "$PG_DATA" "$PG_RUN"
# ★ 存量迁移：旧版 pgdata 在项目目录内（/data/<dir>/pgdata），新版移出到 .pgdata；
#   有旧数据则迁移，避免升级后重建丢数据
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  OLD_PG_DATA="/data/$PROJECT_DIR/pgdata"
  if [ -f "$OLD_PG_DATA/PG_VERSION" ]; then
    echo "[preview] [postgres] 迁移存量数据目录 $OLD_PG_DATA -> $PG_DATA"
    rm -rf "$PG_DATA"
    mkdir -p "$(dirname "$PG_DATA")"
    mv "$OLD_PG_DATA" "$PG_DATA"
  fi
fi
# ★ stale 数据目录残留（异常退出被改名 pgdata.stale-*）：恢复它，避免误判"another server running"后 initdb 新库冲突
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  for d in "$PG_DATA".stale-*; do
    if [ -f "$d/PG_VERSION" ]; then
      echo "[preview] [postgres] 检测到 stale 数据目录 $d，恢复为 $PG_DATA"
      rm -rf "$PG_DATA"
      mv "$d" "$PG_DATA"
      break
    fi
  done
fi
# 清理残留 postmaster.pid（异常退出遗留，pg_ctl 会误判"another server might be running"）
rm -f "$PG_DATA/postmaster.pid"

if pg_ctl -D "$PG_DATA" status >/dev/null 2>&1; then
  echo "[preview] [postgres] already running (skip)"
else
  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    echo "[preview] [postgres] Initializing database cluster..."
    chown -R postgres:postgres "$PG_DATA" "$PG_RUN"
    su postgres -c "initdb -D $PG_DATA --auth=trust --encoding=UTF8"
    # listen localhost：容器内 127.0.0.1 TCP + unix socket 两种连法都支持
    echo "listen_addresses = 'localhost'" >> "$PG_DATA/postgresql.conf"
    echo "unix_socket_directories = '/run/postgresql'" >> "$PG_DATA/postgresql.conf"
  else
    # 兜底：存量数据可能是旧配置（listen_addresses = ''），原地修正
    sed -i "s/^listen_addresses *= *''/listen_addresses = 'localhost'/" "$PG_DATA/postgresql.conf" 2>/dev/null || true
  fi
  chown -R postgres:postgres "$PG_DATA" "$PG_RUN"
  su postgres -c "pg_ctl -D $PG_DATA -l /tmp/postgres.log start -w"
  sleep 1
  su postgres -c "psql -c \"CREATE DATABASE appdb;\"" 2>/dev/null || echo "[preview] [postgres] database appdb already exists"
  su postgres -c "psql -c \"CREATE EXTENSION IF NOT EXISTS pgcrypto;\" -d appdb" 2>/dev/null || true
  echo "[preview] [postgres] Ready on localhost:5432 (db=appdb)"
fi

# ============ 2. 前端代理环境（构建段已生成 vite.config，此处只导出环境变量）============
if [ "$HAS_FRONTEND" = "1" ]; then
  # ★ 短 URL 预览：base=/（资源/API 走根路径，pv-<id8>.<域> 直接打开应用）
  export VITE_BASE="/"
  # ★ HMR host 仅 k8s 用（PREVIEW_DOMAIN 非空 → pv- 子域 wss）；单机 docker 必须留空，
  #   否则 vite 客户端连 wss://pv-<id>.<YOUR-DOMAIN>.com 握手失败（HMR_CLIENT_PORT 注入见上）
  export VITE_HMR_HOST=""
  if [ -n "$PREVIEW_DOMAIN" ]; then
    export VITE_HMR_HOST="pv-${PROJECT_ID:0:8}.${PREVIEW_DOMAIN}"
  fi
  if [ "$HAS_BACKEND" = "1" ]; then
    if [ -f "$DATA_DIR/backend/package.json" ]; then
      export VITE_BE_URL="http://localhost:3001"
    elif [ -f "$DATA_DIR/backend/go.mod" ]; then
      export VITE_BE_URL="http://localhost:3000"
    else
      export VITE_BE_URL="http://localhost:8080"
    fi
  fi
  echo "[preview] VITE_BASE=$VITE_BASE VITE_HMR_HOST=$VITE_HMR_HOST VITE_BE_URL=$VITE_BE_URL"
fi

# ============ 3. 启动后端 ============
echo "=== [3/4] Starting backend ==="
if [ "$HAS_BACKEND" = "1" ]; then
  BACKEND_START="$DATA_DIR/backend-start.sh"
  if [ -f "$BACKEND_START" ]; then
    echo "[preview] Using AI-generated backend-start.sh"
    set +e
    nohup bash "$BACKEND_START" > /proc/1/fd/1 2>&1 &
    echo $! > /tmp/madazi-be.pid
    set -e
    sleep 2
    echo "[preview] backend-start.sh launched (pid $(cat /tmp/madazi-be.pid))"
  else
    echo "[preview] No backend-start.sh, using built-in backend logic"
    BE_DIR="$DATA_DIR/backend"

    if [ -f "$BE_DIR/pom.xml" ]; then
      echo "[preview] [后端] Spring Boot 项目"
      cd "$BE_DIR"
      nohup mvn spring-boot:run -DskipTests > /proc/1/fd/1 2>&1 &
      BE_PID=$!
      echo $BE_PID > /tmp/madazi-be.pid
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
      # pnpm 装的依赖必须 pnpm 跑，npm 解析不了 pnpm 的 symlink 结构
      # ★ 平台契约 Node 后端 = 3001（VITE_BE_URL 同上）；必须显式导出 PORT，
      #   否则后端用模板默认 3000 → vite 代理 3001 全 404
      nohup bash -c "export PORT=3001; pnpm start 2>/dev/null || npm start" > /proc/1/fd/1 2>&1 &
      echo $! > /tmp/madazi-be.pid
      sleep 3
      echo "[preview] [后端] Node.js 服务已启动 (PORT=3001)"

    elif [ -f "$BE_DIR/go.mod" ]; then
      echo "[preview] [后端] Go 项目"
      cd "$BE_DIR"

      # 启动 MariaDB（如有配置文件模板）-- 数据目录放 PVC，Pod 回收不丢
      if [ -f cfg.json.template ] || [ -f cfg.json ]; then
        if mysqladmin ping -u root 2>/dev/null | grep -q 'alive'; then
          echo "[preview] [后端] MariaDB already running (skip)"
        else
          echo "[preview] [后端] 启动 MariaDB..."
          mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld
          MYSQL_DATA="/data/$PROJECT_DIR/mysqldata"
          mkdir -p "$MYSQL_DATA" && chown -R mysql:mysql "$MYSQL_DATA"
          if [ ! -d "$MYSQL_DATA/mysql" ]; then
            mysql_install_db --user=mysql --datadir="$MYSQL_DATA" 2>&1 | tail -2
          fi
          mysqld --user=mysql --datadir="$MYSQL_DATA" > /proc/1/fd/1 2>&1 &
          for i in $(seq 1 15); do
            if mysqladmin ping -u root 2>/dev/null | grep -q 'alive'; then
              echo "[preview] [后端] MariaDB 就绪 (${i}s)"
              break
            fi
            sleep 1
          done
          mysql -u root -e "CREATE DATABASE IF NOT EXISTS appdb;" 2>/dev/null || true
          echo "[preview] [后端] MariaDB 就绪"
        fi

        # 启动 Redis（幂等）
        if redis-cli ping >/dev/null 2>&1; then
          echo "[preview] [后端] Redis already running (skip)"
        else
          echo "[preview] [后端] 启动 Redis..."
          redis-server --daemonize yes 2>/dev/null || true
          echo "[preview] [后端] Redis 就绪"
        fi

        # 处理配置文件
        if [ -f cfg.json.template ]; then
          cp cfg.json.template cfg.json
          sed -i 's|"dsn":\s*"[^"]*"|"dsn": "root:@tcp(127.0.0.1:3306)/appdb?charset=utf8mb4\&parseTime=true\&loc=Local"|g' cfg.json
          sed -i 's|"addr":\s*"[^"]*"|"addr": "127.0.0.1:6379"|g' cfg.json
          sed -i 's|"passwd":\s*"[^"]*"|"passwd": ""|g' cfg.json
          echo "[preview] [后端] cfg.json 已配置（本地 MariaDB + Redis）"
        fi
      fi

      if [ -f server ]; then
        echo "[preview] [后端] 启动 Go 服务...（构建段已编译）"
        nohup ./server > /proc/1/fd/1 2>&1 &
        echo $! > /tmp/madazi-be.pid
        sleep 3
        echo "[preview] [后端] Go 服务已启动"
      elif [ -f /tmp/go-build-failed ]; then
        echo "[preview] [后端] go build 曾失败，尝试 go run main.go"
        nohup go run main.go > /proc/1/fd/1 2>&1 &
        echo $! > /tmp/madazi-be.pid
        sleep 3
        echo "[preview] [后端] Go 服务已启动 (go run)"
      else
        echo "[preview] [后端] ⚠️ server 二进制不存在（构建段未编译？）"
      fi

    elif [ -f "$BE_DIR/requirements.txt" ] || [ -f "$BE_DIR/pyproject.toml" ]; then
      echo "[preview] [后端] Python 项目"
      cd "$BE_DIR"

      # 查找入口文件并启动（依赖已在构建段安装）
      if [ -f app.py ]; then
        echo "[preview] [后端] 启动 python app.py..."
        nohup python app.py > /proc/1/fd/1 2>&1 &
        echo $! > /tmp/madazi-be.pid
        sleep 3
        echo "[preview] [后端] Python 服务已启动"
      elif [ -f main.py ]; then
        echo "[preview] [后端] 启动 python main.py..."
        nohup python main.py > /proc/1/fd/1 2>&1 &
        echo $! > /tmp/madazi-be.pid
        sleep 3
        echo "[preview] [后端] Python 服务已启动"
      elif [ -f manage.py ]; then
        echo "[preview] [后端] 启动 Django (manage.py runserver)..."
        nohup bash -c "python manage.py runserver 0.0.0.0:3001" > /proc/1/fd/1 2>&1 &
        echo $! > /tmp/madazi-be.pid
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
  echo "[preview] [前端] 启动 Vite dev server (:5173)...（依赖已在构建段安装）"
  cd "$FE_DIR"
  nohup npx vite --host 0.0.0.0 --port 5173 > /proc/1/fd/1 2>&1 &
  echo $! > /tmp/madazi-fe.pid
  sleep 2
  echo "[preview] [前端] Vite dev server started (pid $(cat /tmp/madazi-fe.pid))"
else
  echo "[preview] 无前端，仅后端服务"
fi

# ============ 5. 保活（前台占住，容器不退出）============
echo "[preview] All services started. Keeping alive."
tail -f /dev/null
