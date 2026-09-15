#!/usr/bin/env bash
# P2 PG 每日备份：pod 内 pg_dump 落盘校验 → cat 流出 Mac → 双端 md5 比对
# 数据落宿主机磁盘 = 跨 colima VM/磁盘故障保护。
# 用法：backup-pg.sh [保留份数，默认 14]
# 建议 crontab（Mac 侧）：
#   0 4 * * * $HOME/code/madazi/scripts/backup-pg.sh >> "$HOME/backups/madazi-pg/backup.log" 2>&1
# 恢复：
#   kubectl cp <dump> madazi/<pg-pod>:/tmp/ && \
#   kubectl exec deploy/madazi-postgres -- pg_restore -U postgres -d madazi --clean /tmp/<dump>
# 注意：全程不用 kubectl exec -i（colima ssh 不传播 stdin EOF → 永挂）
set -euo pipefail

KEEP="${1:-14}"
DEST="${MADAZI_PG_BACKUP_DIR:-$HOME/backups/madazi-pg}"
POD_TMP=/tmp/madazi-bk-$$.dump
K() { colima ssh -p madazi -- sudo k3s kubectl -n madazi "$@"; }

cleanup() { K exec deploy/madazi-postgres -- rm -f "$POD_TMP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

mkdir -p "$DEST"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/madazi-$TS.dump"

# 1) pod 内 dump + TOC 完整性校验 + 算 md5（一次性输出）
INFO=$(K exec deploy/madazi-postgres -- sh -c \
  "pg_dump -U postgres -Fc madazi -f '$POD_TMP' && pg_restore --list '$POD_TMP' > /dev/null && echo DUMP_OK && md5sum '$POD_TMP'" \
  | tr -d '\r')
if ! grep -q DUMP_OK <<<"$INFO"; then
  echo "[$(date '+%F %T')] FAIL: pg_dump/TOC 校验失败" >&2
  exit 1
fi
POD_MD5=$(awk '/^[0-9a-f]{32}/{print $1}' <<<"$INFO" | head -1)
[ -n "$POD_MD5" ] || { echo "[$(date '+%F %T')] FAIL: 未取到 pod md5" >&2; exit 1; }

# 2) cat 流出（纯 stdout 二进制，无 stdin 依赖）
K exec deploy/madazi-postgres -- cat "$POD_TMP" > "$OUT.tmp"

# 3) 双端 md5 比对（传输完整性）
MAC_MD5=$(md5 -q "$OUT.tmp")
if [ "$MAC_MD5" != "$POD_MD5" ]; then
  rm -f "$OUT.tmp"
  echo "[$(date '+%F %T')] FAIL: md5 不一致 pod=$POD_MD5 mac=$MAC_MD5" >&2
  exit 1
fi
mv "$OUT.tmp" "$OUT"
echo "[$(date '+%F %T')] OK: $(basename "$OUT") $(du -h "$OUT" | cut -f1) md5=${MAC_MD5:0:8}"

# 4) 轮转：只保留最近 KEEP 份
ls -t "$DEST"/madazi-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r f; do
  rm -f "$f"
done
