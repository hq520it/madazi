FROM node:24-bookworm-slim

# 国内镜像源加速 + git/curl（构建任务）+ ca-certificates（git https clone 验 TLS，--no-install-recommends 不会自动带）
# + zstd（dsh session 快照计费解压）+ pnpm（dsh 插件市场安装用）
# ★ 单机 docker 版已移除（2026-08），预览全跑 K8s Pod，不再需要 docker CLI
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
      /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
      /etc/apt/sources.list 2>/dev/null; \
    apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates zstd && \
    rm -rf /var/lib/apt/lists/* && \
    npm i -g pnpm@11 --registry=https://registry.npmmirror.com

WORKDIR /app

ENV npm_config_registry=https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY templates/ ./templates/
COPY preview-templates/ ./preview-templates/
COPY public/ ./public/
COPY .env ./

EXPOSE 3456

CMD ["node", "src/index.js"]
