# madazi-acp — dsh 高级 Agent 沙箱容器（linux glibc + Node 24 + Java 17 + Go 1.22 + Python 3 + DSH npm 形态）
# 红线：cap_drop ALL + no-new-privileges + 2g/1cpu/pids100 + bridge 网络（agent 需调模型 API）
FROM node:24-bookworm-slim

# 国内镜像源加速（debian 源换阿里云）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
      /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
      /etc/apt/sources.list 2>/dev/null; \
    apt-get update && \
    apt-get install -y --no-install-recommends bash zstd git ca-certificates curl procps bubblewrap \
      # Java 17 (OpenJDK)
      openjdk-17-jdk-headless \
      # Python 3 + pip + pytest
      python3 python3-pip python3-venv \
      # Go 1.22（bookworm 默认源版本）
      golang \
      # Maven + Gradle（Java 构建工具）
      maven \
      # 常用构建工具
      make g++ \
    && rm -rf /var/lib/apt/lists/*

# Go 环境变量（GOPATH 放 tmpfs 可写区）
ENV GOPATH=/tmp/go
ENV PATH="${PATH}:/tmp/go/bin"

# ★ npm 形态（2026-08-19）：dsh CLI + pnpm 全局安装（插件市场后续靠 server 端 pnpm 操作共享 PVC profile）
RUN npm i -g @deepseek-ai/dsh@next pnpm@11 --registry=https://registry.npmmirror.com

# ★ profile 固化：生产 cordis.yml + 29 包 @next（镜像内 pnpm install，PVC 首启由 initContainer 复制）
COPY profile-package.json /opt/dsh-profile/package.json
COPY pnpm-workspace.yaml /opt/dsh-profile/pnpm-workspace.yaml
COPY cordis.yml /opt/dsh-profile/cordis.yml
RUN cd /opt/dsh-profile && pnpm install --registry=https://registry.npmmirror.com

# dsh-agent wrapper（DSH_EXE 兼容：桥 spawn /usr/local/bin/dsh-agent 无感知，exec 到 SDK demo bin）
COPY dsh-agent /usr/local/bin/dsh-agent
RUN chmod +x /usr/local/bin/dsh-agent

# ★ TCP-stdio 桥（/app 将被 PVC 整目录挂载，桥必须移出 /app——2026-08-19 插件市场前提）
COPY dsh-bridge-tcp.js /opt/dsh/dsh-bridge-tcp.js
# 桥的旁路依赖（ioredis/pg）：装到 /opt/dsh/node_modules（bridge require 解析链；profile 的 /app/node_modules 是 dsh 插件依赖）
RUN cd /opt/dsh && npm i ioredis pg --registry=https://registry.npmmirror.com --no-audit --no-fund
ENV DSH_TCP_PORT=7001
EXPOSE 7001

WORKDIR /tmp
ENTRYPOINT ["node", "/opt/dsh/dsh-bridge-tcp.js"]
