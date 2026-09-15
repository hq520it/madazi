# madazi-preview-template v1.0.0 (2026-08-06)
# Tech: Frontend-only (Vite, no backend)
# Cache: madazi-pnpm-store
FROM node:18-alpine

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.huaweicloud.com|g' /etc/apk/repositories \
  && apk add --no-cache bash curl \
  && npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm \
  && pnpm config set registry https://registry.npmmirror.com

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app

ENTRYPOINT ["bash", "/app/entrypoint.sh"]
