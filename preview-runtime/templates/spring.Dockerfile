# madazi-preview-template v1.0.0 (2026-08-06)
# Tech: Spring Boot backend + Vite frontend
# Cache: madazi-pnpm-store + madazi-maven-cache
FROM node:18-alpine

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

# JDK + Maven（从 maven 镜像复制，避免重复下载）
COPY --from=maven:3.9-eclipse-temurin-17-alpine /opt/java /opt/java
COPY --from=maven:3.9-eclipse-temurin-17-alpine /usr/share/maven /usr/share/maven

ENV JAVA_HOME=/opt/java/openjdk
ENV MAVEN_HOME=/usr/share/maven
ENV PATH=$JAVA_HOME/bin:$MAVEN_HOME/bin:$PATH
ENV MAVEN_CONFIG=/root/.m2

# 国内镜像源 + pnpm + Maven 阿里云镜像
RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.huaweicloud.com|g' /etc/apk/repositories \
  && apk add --no-cache bash curl postgresql16 postgresql16-contrib mariadb mariadb-client redis \
  && mkdir -p /var/lib/postgresql/data /run/postgresql \
  && chown -R postgres:postgres /var/lib/postgresql /run/postgresql \
  && mysql_install_db --user=mysql --datadir=/var/lib/mysql 2>/dev/null \
  && mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld \
  && npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm \
  && pnpm config set registry https://registry.npmmirror.com \
  && mkdir -p /root/.m2 \
  && echo '<settings><mirrors><mirror><id>aliyun</id><mirrorOf>central</mirrorOf><url>https://maven.aliyun.com/repository/public</url></mirror></mirrors></settings>' > /root/.m2/settings.xml

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app

ENTRYPOINT ["bash", "/app/entrypoint.sh"]
