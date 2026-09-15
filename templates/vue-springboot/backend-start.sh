#!/bin/bash
# Madazi (Spring Boot 3 + PostgreSQL + Redis) 后端启动脚本
# 由 entrypoint.sh 阶段3 同步调用：bash "$DATA_DIR/backend-start.sh"
# 职责：起 PostgreSQL -> 导 SQL -> 起 Redis -> mvn 构建 -> java -jar 后台启动
# 前端 vite 由 entrypoint.sh 阶段4 统一启动（exec 主进程），本脚本只负责后端、不阻塞
set -e

DATA_DIR="$(cd "$(dirname "$0")" && pwd)"
BE_DIR="$DATA_DIR/backend"
cd "$BE_DIR"

# 环境变量（application-druid.yml 使用 ${PG_*:默认值} / ${REDIS_*:默认值} 占位符）
export PG_HOST="${PG_HOST:-localhost}"
export PG_PORT="${PG_PORT:-5432}"
export PG_USER="${PG_USER:-postgres}"
export PG_PASSWORD="${PG_PASSWORD:-}"
export PG_DB="${PG_DB:-madazi}"
export REDIS_HOST="${REDIS_HOST:-localhost}"
export REDIS_PORT="${REDIS_PORT:-6379}"

echo "[backend-start] ==========================================="
echo "[backend-start] Madazi 后端启动 (PostgreSQL + Redis + Spring Boot)"
echo "[backend-start] PG=$PG_HOST:$PG_PORT DB=$PG_DB REDIS=$REDIS_HOST:$REDIS_PORT"

# ---------- 1. 确保 PostgreSQL 运行 ----------
echo "[backend-start] [1/5] 确保 PostgreSQL 运行..."
if pg_isready -q 2>/dev/null; then
  echo "[backend-start] PostgreSQL 已在运行"
else
  # 预览容器预装 PostgreSQL 16，此处兜底启动（正常情况 entrypoint 已启动）
  su postgres -c "pg_ctl -D /var/lib/postgresql/data -l /tmp/pg.log start" 2>/dev/null \
    || service postgresql start 2>/dev/null \
    || echo "[backend-start] ⚠️ 无法自动启动 PostgreSQL，请检查环境"
  for i in $(seq 1 30); do
    if pg_isready -q 2>/dev/null; then
      echo "[backend-start] PostgreSQL 就绪 (${i}s)"
      break
    fi
    sleep 1
  done
fi

# ---------- 2. 创建数据库 + 导入 SQL ----------
echo "[backend-start] [2/5] 创建数据库并导入 SQL..."
if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${PG_DB}'\"" 2>/dev/null | grep -q 1; then
  su postgres -c "createdb ${PG_DB}"
  echo "[backend-start] 数据库 ${PG_DB} 已创建"
fi
SQL_FILE=$(find sql -maxdepth 1 -name 'madazi_*.sql' 2>/dev/null | head -1)
if [ -n "$SQL_FILE" ]; then
  # ON_ERROR_STOP=0：个别语句不兼容时跳过继续（打印到日志，不阻塞）
  su postgres -c "psql -v ON_ERROR_STOP=0 -d ${PG_DB} -f \"$PWD/$SQL_FILE\"" > /tmp/psql-init.log 2>&1 || true
  echo "[backend-start] SQL 导入完成: $SQL_FILE（日志 /tmp/psql-init.log）"
else
  echo "[backend-start] ⚠️ 未找到 sql/madazi_*.sql，跳过导入"
fi

# ---------- 3. 启动 Redis ----------
echo "[backend-start] [3/5] 启动 Redis..."
redis-server --daemonize yes 2>/dev/null || true
sleep 1
redis-cli ping 2>/dev/null | grep -q PONG && echo "[backend-start] Redis 就绪" || echo "[backend-start] ⚠️ Redis 未就绪（登录/验证码可能异常）"

# ---------- 4. Maven 构建 ----------
echo "[backend-start] [4/5] Maven 构建 (跳过测试)..."
# ★ 必须强制重建：热替换要求「运行类」与「watch 增量编译」字节码同源（同 JDK 编译）。
# 若跳过构建，运行类 = 生成项目时 rsync 的旧产物（服务器 JDK 编译），与容器内 javac 产物
# 存在合成方法差异 → HotSwapAgent redefine 报 "attempted to add a method"。
MAVEN_OPTS='-Xmx1024m -XX:MaxMetaspaceSize=384m' mvn -B -DskipTests package
echo "[backend-start] 构建完成（字节码与运行环境一致，热替换可用）"

# ---------- 5. 启动 Spring Boot ----------
echo "[backend-start] [5/5] 启动 Spring Boot (8080)..."
JAR="madazi-admin/target/madazi-admin.jar"
if [ ! -f "$JAR" ]; then
  echo "[backend-start] ❌ 未找到 $JAR"
  exit 1
fi

# ★ 热更新（HotSwapAgent）：exploded classpath 启动 + autoHotswap=true
# - 依赖 jar 从 fat jar 解出到 /tmp/app-extracted/BOOT-INF/lib（一次性）
# - classpath 指向各模块 target/classes（mvn compile 产物），agent 监听该目录
# - 改代码 → watch 循环增量编译 → agent 检测到 class 变化 → JVM 内热替换（秒级、不重启）
touch /tmp/backend-marker
rm -rf /tmp/app-extracted && unzip -q "$JAR" "BOOT-INF/lib/*" -d /tmp/app-extracted
MODULES_CP=$(find . -maxdepth 1 -type d -name "madazi-*" | while read -r d; do [ -d "$d/target/classes" ] && printf "%s/target/classes:" "$d"; done)
CP="${MODULES_CP%/}:/tmp/app-extracted/BOOT-INF/lib/*"
if [ -f /opt/hotswap-agent.jar ]; then
  echo "[backend-start] HotSwapAgent 已启用（改代码自动热替换，不重启）"
  # JDK9+ 模块系统需 --add-opens，否则 agent 反射失败（java.io 等）
  HSA_OPENS="--add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.lang.invoke=ALL-UNNAMED --add-opens=java.base/java.lang.reflect=ALL-UNNAMED --add-opens=java.base/java.io=ALL-UNNAMED --add-opens=java.base/java.net=ALL-UNNAMED --add-opens=java.base/java.nio=ALL-UNNAMED --add-opens=java.base/java.util=ALL-UNNAMED --add-opens=java.base/java.util.concurrent=ALL-UNNAMED --add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED --add-opens=java.base/sun.nio.ch=ALL-UNNAMED --add-opens=java.base/sun.nio.cs=ALL-UNNAMED --add-opens=java.base/sun.security.action=ALL-UNNAMED --add-opens=java.base/sun.util.calendar=ALL-UNNAMED --add-opens=java.base/java.security=ALL-UNNAMED"
  # 禁用 MyBatisPlus 插件：项目为纯 MyBatis，agent 误激活 plus 插件会改写 XMLConfigBuilder 注入不存在的类导致 NoClassDefFoundError
  # ★ 日志 tee 双写：stdout（日志面板实时可见）+ /tmp/madazi.log（热更新调试用）
  # 注意：镜像内是 busybox tail，不支持 GNU 的 --pid 参数，故不用 tail -f 镜像
  java -Xmx1024m -XX:MaxMetaspaceSize=256m -javaagent:/opt/hotswap-agent.jar=autoHotswap=true,disabledPlugins=MyBatisPlus $HSA_OPENS -cp "$CP" com.madazi.MadaziApplication 2>&1 | tee /tmp/madazi.log &
  BE_PID=$!
else
  echo "[backend-start] ⚠️ 未找到 /opt/hotswap-agent.jar，降级 java -jar 普通启动"
  java -Xmx1024m -XX:MaxMetaspaceSize=256m -jar "$JAR" 2>&1 | tee /tmp/madazi.log &
  BE_PID=$!
fi
echo "[backend-start] 后端进程 PID=$BE_PID"

# ★ 热更新 watch 循环：源码变更 → javac 增量编译（只编变化的文件）→ HotSwapAgent 自动热替换
# 不用 mvn compile：maven-compiler-plugin 全量重编模块所有类 → agent 批量 reload → 某类合成方法
# 差异 → redefine 报 "attempted to add a method"。javac 单文件增量 → 每次只 reload 1 个类 → 稳定热替换。
(
  while true; do
    # ★ 必须先 find 收集变化文件再 touch marker（先 touch 会导致 find -newer 恒为空 → javac 编译列表为空）
    CHANGED=$(find . -name "*.java" -newer /tmp/backend-marker -not -path "*/target/*" 2>/dev/null)
    if [ -n "$CHANGED" ]; then
      touch /tmp/backend-marker
      echo "[hotswap] 检测到源码变更，javac 增量编译..."
      CP="/tmp/app-extracted/BOOT-INF/lib/*"
      for d in madazi-*; do [ -d "$d/target/classes" ] && CP="$CP:$d/target/classes"; done
      echo "$CHANGED" | while read -r f; do
        [ -z "$f" ] && continue
        MOD=$(echo "$f" | cut -d/ -f2)
        if javac -encoding UTF-8 -parameters -nowarn -cp "$CP" -d "$MOD/target/classes" "$f" 2>>/tmp/javac-hotswap.log; then
          echo "[hotswap]   ✓ $f"
        else
          echo "[hotswap]   ✗ $f 编译失败（详见 /tmp/javac-hotswap.log）"
        fi
      done
      echo "[hotswap] 编译完成，HotSwapAgent 自动热替换，浏览器刷新即见"
    fi
    sleep 3
  done
) &

# 等待就绪（最多约 90s）
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ 2>/dev/null) || CODE="000"
  if [ "$CODE" != "000" ] && [ -n "$CODE" ]; then
    echo "[backend-start] ✅ 后端就绪 (HTTP $CODE)"
    break
  fi
  sleep 3
done
echo "[backend-start] 完成（前端由 entrypoint 阶段4 启动）"
