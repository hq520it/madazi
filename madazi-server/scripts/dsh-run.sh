#!/bin/sh
# dsh ACP 包装脚本：madazi-server 容器内由 dsh-bridge.js spawn(exe, [configPath]) 调用。
# stdio 透传到每项目常驻 dsh 容器内的 dsh exe（docker.sock + docker exec -i），
# configPath 参数被忽略（exec 显式指定 /app/cordis.yml）。
#
# 常驻容器模式（替代原每任务 docker run -i --rm）：
#   - 常驻容器由 JS 层 ensureDshContainer()（services/dsh-container.js）启动；
#     本脚本仅兜底：容器不存在/已退出时自行 run -d 重建（防竞态与 server 重启后孤儿）。
#   - 挂载：/app/generated 整卷 rw（worktree 由容器内 git 创建，server 同卷可见）、
#     /data 只读 + .dsh-sessions 可写；沙箱红线保持（--read-only/cap_drop/pids/网络）。
#   - 写范围收窄依赖 dsh 的 DSH_PERMISSION_MODE=workspace-write（agent 层限制）。
#   - 容器名 = madazi-acp-{projectId}（项目级唯一，无任务后缀）。

NAME="madazi-dsh-${DSH_PROJECT_ID:-0}"

if ! docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null | grep -q true; then
  # 兜底启动常驻容器（参数与 dsh-container.js containerRunArgs 一致，改动需同步两处）
  docker rm -f "$NAME" >/dev/null 2>&1
  docker run -d --name "$NAME" \
    --network madazi-preview-net \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --read-only \
    --tmpfs /tmp:rw,size=256m,mode=1777,exec \
    --tmpfs /run:rw,size=16m,mode=1777,exec \
    --memory 2g --cpus 1 --pids-limit 100 \
    -e HOME=/tmp \
    -v /home/ubuntu/madazi-preview-projects:/data:ro \
    -v /home/ubuntu/madazi-preview-projects/.dsh-sessions:/data/.dsh-sessions:rw \
    -v madazi_madazi-generated:/app/generated:rw \
    --entrypoint /bin/sleep \
    madazi-dsh:latest infinity >/dev/null
fi

# exec 复用常驻容器，stdio 透传语义与 docker run -i 完全一致（bridge 无感知）
# ★ --workdir 必须：容器内 cordis.yml workspaceRoot=process.cwd()，默认 / 是 read-only 会崩
exec docker exec -i --workdir "${DSH_WORKTREE:-/app/generated}" \
  -e DSH_WORKTREE \
  -e DSH_PROJECT_ID \
  -e DEEPSEEK_API_KEY -e DEEPSEEK_BASE_URL -e DEEPSEEK_MODEL \
  -e DSH_PERMISSION_MODE -e DSH_SNAPSHOT_SESSIONS_ROOT \
  "$NAME" /usr/local/bin/dsh-agent /app/cordis.yml
