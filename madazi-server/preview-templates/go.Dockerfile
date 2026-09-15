# madazi-preview-template v1.0.0 (2026-08-06)
# Tech: Go backend + Vite frontend
# Cache: madazi-pnpm-store + madazi-go-cache
FROM node:18-alpine

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

# 国内镜像源 + pnpm + Go
RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.huaweicloud.com|g' /etc/apk/repositories \
  && apk add --no-cache bash curl postgresql16 postgresql16-contrib mariadb mariadb-client redis git \
  && mkdir -p /var/lib/postgresql/data /run/postgresql \
  && chown -R postgres:postgres /var/lib/postgresql /run/postgresql \
  && mysql_install_db --user=mysql --datadir=/var/lib/mysql 2>/dev/null \
  && mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld \
  && npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm \
  && pnpm config set registry https://registry.npmmirror.com \
  && curl -fsSL https://mirrors.aliyun.com/golang/go1.25.0.linux-amd64.tar.gz | tar -C /usr/local -xzf -

ENV GOROOT=/usr/local/go
ENV GOPATH=/root/go
ENV PATH=$GOROOT/bin:$GOPATH/bin:$PATH

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app

ENTRYPOINT ["bash", "/app/entrypoint.sh"]
