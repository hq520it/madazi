# React + Spring Boot 项目编码规范

> AI 生成代码时必须严格遵循以下规范。

## 预览环境拓扑（禁止改偏，最高优先级）

项目在平台里不是本机跑服务，预览流量链路固定，**改动任何一环都会 404 / 连不上**：

```
浏览器 → pv-xxx.<YOUR-DOMAIN>.com（或主站 /api/projects/{id}/preview-proxy/）
  → 平台 server 反代（路径透传）
  → 预览容器 Vite dev server（base = /api/projects/{id}/preview-proxy，由 VITE_BASE 注入）
  → Vite proxy 把「带 base 前缀的 /api 请求」rewrite 后转发到后端 8080
```

铁律（违反 = 预览 404）：
- ★ 前端 API 请求必须带 base 前缀：`fetch(import.meta.env.BASE_URL + 'api/...')`（axios 用 baseURL=import.meta.env.BASE_URL + 相对 url 'api/...'）
- ★ 禁止写死 `/api/...` 绝对路径（预览下命中不了 Vite proxy）；禁止相对路径 `./api`（pv 子域名页面 URL 是根路径，解析后仍不带 base）
- ★ 禁止 `http://localhost:8080` / IP 硬编码后端地址
- ★ 禁止改动 `vite.config.*` 的 `base` / `proxy` / `server.hmr` 结构（base 由平台 VITE_BASE 注入，hmr 必须关闭）
- ★ 禁止改后端监听端口（固定 8080）

## 项目结构

```
frontend/
├── src/
│   ├── pages/           # 页面组件
│   ├── components/      # 可复用组件
│   ├── api/             # API 调用
│   ├── hooks/           # 自定义 Hooks
│   └── App.tsx          # 路由入口
├── package.json
└── vite.config.ts

backend/
├── src/main/java/com/app/
│   ├── controller/      # REST 控制器
│   ├── service/         # 业务逻辑
│   ├── entity/          # JPA 实体
│   ├── repository/      # Spring Data JPA Repository
│   ├── config/          # 配置类
│   └── AppApplication.java
├── src/main/resources/
│   └── application.yml
└── pom.xml
```

## 后端规范

- Java 17 + Spring Boot 3.2+
- 数据库主键：UUID（VARCHAR(64)，gen_random_uuid()）
- 实体类用 @Entity + @Table
- Repository 继承 JpaRepository
- Controller 用 @RestController + @RequestMapping("/api/xxx")
- Service 用 @Service 注解
- 统一异常处理用 @ControllerAdvice
- API 返回格式：{ "code": 200, "data": ..., "message": "success" }
- 分页用 Spring Data Pageable

## 前端规范

- React 19 + TypeScript
- 路由用 react-router-dom v7
- API 调用统一封装在 src/api/ 下
- 组件用函数式组件 + Hooks
- 样式用 CSS Modules 或内联样式，不用 CSS-in-JS
- 表单受控组件
- 列表页统一分页 + 搜索

## 数据库

- PostgreSQL 16
- 表名蛇形命名：user_account, order_detail
- 字段名蛇形命名：created_at, updated_at
- 每张表必须有：id (UUID), created_at, updated_at

## API 设计

- RESTful 风格
- GET /api/resources - 列表
- GET /api/resources/:id - 详情
- POST /api/resources - 创建
- PUT /api/resources/:id - 更新
- DELETE /api/resources/:id - 删除
- 列表接口支持 ?page=0&size=20&search=xxx

## 禁止

- 禁止使用 BIGSERIAL 主键
- 禁止在 Controller 写业务逻辑
- 禁止前端硬编码 API 地址
- 禁止使用 var 声明变量
