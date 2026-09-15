#!/usr/bin/env bash
# madazi 自动备份（quda cron 每天 3:30 执行）
# - 数据库 pg_dump 压缩
# - 部署配置（compose + License 私钥目录）打包
# - 保留最近 KEEP 份，自动清理旧备份
set -euo pipefail

BACKUP_ROOT=/home/ubuntu/backups/madazi
KEEP=7
STAMP=$(date +%Y%m%d-%H%M)
DB_DIR="$BACKUP_ROOT/db"
CFG_DIR="$BACKUP_ROOT/config"
LOG="$BACKUP_ROOT/backup.log"

mkdir -p "$DB_DIR" "$CFG_DIR"

# 1. 数据库 dump（容器内 pg_dump → gzip）
if ! sudo docker exec madazi-postgres pg_dump -U madazi -d madazi 2>/dev/null | gzip > "$DB_DIR/madazi-$STAMP.sql.gz"; then
  echo "[$(date '+%F %T')] ❌ pg_dump 失败" >> "$LOG"
  exit 1
fi

# 2. 配置打包（compose 含 KEY_MASTER_SECRET/DB 密码/License 私钥，与 DB 分开存放以便恢复）
tar czf "$CFG_DIR/madazi-config-$STAMP.tar.gz" -C /home/ubuntu \
  docker-compose.prod.yml \
  madazi-server-full/scripts/keys 2>/dev/null || true

# 3. 清理旧备份（保留最近 KEEP 份）
ls -1t "$DB_DIR"/*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$CFG_DIR"/*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date '+%F %T')] ✅ db=$(ls -1 "$DB_DIR" | wc -l | tr -d ' ')份 config=$(ls -1 "$CFG_DIR" | wc -l | tr -d ' ')份 (keep=$KEEP) 最新: madazi-$STAMP.sql.gz" >> "$LOG"
