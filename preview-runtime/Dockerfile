FROM docker.1ms.run/library/node:18-alpine

# JDK17 + Maven 走 alpine 源（阿里云镜像；maven:...-alpine 官方镜像无 arm64 manifest）
RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.huaweicloud.com|g' /etc/apk/repositories \
  && apk add --no-cache bash curl postgresql16 postgresql16-contrib openjdk17 maven \
  && mkdir -p /var/lib/postgresql/data /run/postgresql \
  && chown -R postgres:postgres /var/lib/postgresql /run/postgresql

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk
ENV PATH=$JAVA_HOME/bin:$PATH
ENV MAVEN_CONFIG=/root/.m2

# 预装 PostgreSQL 16 + MariaDB + Redis（国内镜像源加速）
# Go 从官方二进制安装（apk 版本太旧，1.25 需要手动装）
RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.huaweicloud.com|g' /etc/apk/repositories \
  && apk add --no-cache bash curl postgresql16 postgresql16-contrib mariadb mariadb-client redis \
  && mkdir -p /var/lib/postgresql/data /run/postgresql \
  && chown -R postgres:postgres /var/lib/postgresql /run/postgresql \
  && mysql_install_db --user=mysql --datadir=/var/lib/mysql 2>/dev/null \
  && mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld \
  && curl -fsSL https://mirrors.aliyun.com/golang/go1.25.0.linux-arm64.tar.gz | tar -C /usr/local -xzf - \
  && curl -fsSL -o /opt/hotswap-agent.jar https://maven.aliyun.com/repository/public/org/hotswapagent/hotswap-agent/2.0.1/hotswap-agent-2.0.1.jar \
  && corepack enable \
  && (COREPACK_NPM_REGISTRY=https://registry.npmmirror.com corepack prepare pnpm@9.15.0 --activate 2>/dev/null || npm i -g pnpm@9 --registry=https://registry.npmmirror.com)

ENV GOROOT=/usr/local/go
ENV GOPATH=/root/go
ENV PATH=$GOROOT/bin:$GOPATH/bin:$PATH

# Maven 共享缓存配置（localRepository=/data/.m2-repo，与 spring 镜像同款）
COPY settings.xml /root/.m2/settings.xml

# 方案C：entrypoint.sh 替代 start.sh
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 保留旧 start.sh 作为 fallback（兼容已有容器）
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

WORKDIR /app

ENTRYPOINT ["bash", "/app/entrypoint.sh"]
