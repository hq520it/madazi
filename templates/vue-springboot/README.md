# Vue + Spring Boot (Madazi)

基于 [Madazi-Vue](https://gitee.com/y_project/Madazi-Vue) 与 [Madazi-Vue3](https://gitee.com/y_project/Madazi-Vue3) 精简改造的前后端分离脚手架，内置用户管理、角色权限（RBAC）、菜单、部门、岗位、字典、操作/登录日志等基础能力，开箱即用。

## 技术栈

| 端 | 技术 |
| --- | --- |
| 后端 | Java 17 · Spring Boot 3 · MyBatis · MariaDB · Redis · Druid |
| 前端 | Vue 3 · Vite 6 · Element Plus · Pinia · vue-router |

## 目录结构

```
backend/          # Spring Boot 多模块后端（madazi-admin / madazi-common / madazi-framework / madazi-system）
frontend/         # Vue 3 前端
sql/              # 数据库初始化脚本（MariaDB）
```

## 快速启动（预览环境）

预览容器已内置 MariaDB + Redis，启动脚本 `backend-start.sh` 会自动：

1. 启动 MariaDB 并导入 `sql/madazi_*.sql`
2. 启动 Redis
3. Maven 构建后端并后台运行（8080）
4. 前端由预览引擎启动（5173）

前端访问 5173，`/api` 请求代理到后端 8080。

## 数据库

- 引擎：MariaDB（MySQL 兼容）
- 默认库名：`madazi`（可通过环境变量 `MYSQL_DB` 覆盖）
- 连接参数：`MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD`（均带默认值）
- 主键：全部 `VARCHAR(64)` UUID 字符串，无自增整数主键

## 默认账号

- 管理员：`admin` / 默认密码见 Madazi 官方约定（生产环境请立即修改）

## 常用命令

```bash
# 后端构建
cd backend && mvn -DskipTests package
# 后端运行
java -jar madazi-admin/target/madazi-admin.jar

# 前端开发
cd frontend && pnpm install && pnpm dev   # http://localhost:5173
# 前端构建
cd frontend && pnpm build:prod
```

## 新增业务模块

1. 后端：在 `madazi-system` 下新建 domain / mapper / service，Controller 放 `madazi-admin` 的 `com.madazi.web.controller`
2. 前端：在 `src/api/` 建接口封装、`src/views/` 建页面、`src/router/` 注册路由
3. 数据库：新增表并在 `sql/` 脚本登记，菜单在 `sys_menu` 登记
4. 详细编码规范见 `AGENTS.md`
