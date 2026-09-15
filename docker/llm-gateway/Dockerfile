FROM node:24-bookworm-slim
# 时区（bookworm-slim 用 apt；纯 Node 网关无需额外包）
ENV TZ=Asia/Shanghai \
    NODE_ENV=production
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app
# npm 国内源
RUN npm config set registry https://registry.npmmirror.com

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.js ./
EXPOSE 3459
# 健康检查：无 key 401 也算存活
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3459/healthz').then(r=>process.exit(r.ok||r.status===401?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
