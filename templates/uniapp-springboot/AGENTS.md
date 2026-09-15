# uni-app + Spring Boot 项目编码规范

> AI 生成代码时必须严格遵循以下规范。

## 预览环境拓扑（禁止改偏，最高优先级）

项目在平台里不是本机跑服务，预览流量链路固定（H5 预览），**改动任何一环都会 404 / 连不上**：

```
浏览器 → pv-xxx.<YOUR-DOMAIN>.com（或主站 /api/projects/{id}/preview-proxy/）
  → 平台 server 反代（路径透传）
  → 预览容器 Vite dev server（H5，base 由平台 VITE_BASE 注入）
  → Vite proxy 把「/api 请求」rewrite 后转发到后端 8080
```

铁律（违反 = 预览 404）：
- ★ uni.request 的 baseURL 必须用 `import.meta.env.BASE_URL + 'api'`（H5）或平台注入地址，**禁止 `http://localhost:8080/api` 硬编码**（预览下 localhost 指向用户本机，打不到容器）
- ★ 禁止写死 `/api/...` 绝对路径、禁止相对路径 `./api`（pv 子域名页面 URL 是根路径，解析后仍不带 base）
- ★ 禁止改动 H5 devServer proxy / base / hmr 配置结构（base 由平台 VITE_BASE 注入，hmr 必须关闭）
- ★ 禁止改后端端口 / context-path（固定 8080，context-path=/api）

## 项目结构

```
frontend/
├── src/
│   ├── pages/               # 页面组件（与 pages.json 中 path 一一对应）
│   │   └── index/index.vue
│   ├── components/          # 可复用组件
│   ├── api/                 # API 调用统一封装（基于 uni.request）
│   ├── utils/               # 工具函数
│   ├── App.vue              # 应用根组件
│   ├── main.ts              # 入口
│   ├── pages.json           # 页面路由配置
│   ├── manifest.json        # 应用配置（appid 留空）
│   └── uni.scss             # 全局样式变量
├── pages.json               # 根级冗余配置（HBuilderX 兼容）
├── manifest.json            # 根级冗余配置
└── package.json

backend/
├── src/main/java/com/madazi/
│   ├── controller/          # REST 控制器
│   ├── service/             # 业务逻辑
│   ├── entity/              # JPA 实体
│   ├── repository/          # Spring Data JPA Repository
│   ├── config/              # 配置类（CORS、UUID 转换等）
│   └── AppApplication.java
├── src/main/resources/
│   └── application.yml
└── pom.xml
```

## 后端规范

- Java 17 + Spring Boot 3.2+
- 数据库主键：UUID（**强制 VARCHAR(64)**，不使用原生 uuid 列类型）
- 实体类用 `@Entity` + `@Table`
- Repository 继承 `JpaRepository`
- Controller 用 `@RestController` + `@RequestMapping("/api/xxx")`
  - 注意：`application.yml` 中 `server.servlet.context-path: /api`，故 Controller 内 `@RequestMapping("/items")` 即对应 `/api/items`
- Service 用 `@Service` 注解
- 统一异常处理用 `@ControllerAdvice`
- API 返回格式：`{ "code": 200, "data": ..., "message": "success" }`
- 分页用 Spring Data `Pageable`
- `@PrePersist` 中通过 `java.util.UUID.randomUUID().toString()` 生成主键
- `UuidConverter` 实现 `AttributeConverter<String, Object>`，`@Converter(autoApply = true)` 全局生效

## 前端规范（uni-app + Vue 3）

- Vue 3 `<script setup lang="ts">` 组合式 API
- 不使用 Options API，不使用 mixin
- 单位统一用 `rpx`（设计稿宽 750rpx = 750px @2x）
- **圆角统一 24rpx**（按钮、卡片、输入框）
- **按钮紧跟内容下方**，不悬浮、不绝对定位
- 列表项布局：左侧内容、右侧操作按钮（删除/编辑）
- 空数据状态显示 "暂无数据"
- API 调用统一封装，基于 `uni.request`，不直接用 fetch（H5 与小程序行为一致）
- 请求 baseURL 通过常量管理，不硬编码到组件
- 小程序合法域名在 `manifest.json` 中 `mp-weixin.setting.urlCheck: false`（仅开发期，生产务必配置）
- H5 dev server proxy 在 `manifest.json` `h5.devServer.proxy` 中配置
- 页面间传参用 URL query，复杂数据用 uni 全局缓存或状态管理

## 小程序 UI 约定

- 间距：`24rpx`（卡片内 padding）、`16rpx`（表单项 margin-bottom）
- 字号：标题 `36rpx`、列表项 `30rpx`、辅助文字 `26rpx`
- 主色 `#007aff`，危险色 `#dd524d`，背景 `#f5f5f5`
- 卡片有轻微阴影：`box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04)`
- 按钮高度 `80rpx`，圆角 `24rpx`
- input/textarea 背景用浅灰 `#f5f5f5`

## 数据库

- PostgreSQL 16
- 表名蛇形命名：`user_account`, `order_detail`
- 字段名蛇形命名：`created_at`, `updated_at`
- 每张表必须有：`id` (UUID VARCHAR(64)), `created_at`, `updated_at`

## API 设计

- RESTful 风格
- `GET    /api/resources`       - 列表
- `GET    /api/resources/:id`   - 详情
- `POST   /api/resources`       - 创建
- `PUT    /api/resources/:id`   - 更新
- `DELETE /api/resources/:id`   - 删除
- 列表接口支持 `?page=0&size=20&search=xxx`

## 禁止

- 禁止使用 BIGSERIAL 主键
- 禁止主键使用 PostgreSQL 原生 `uuid` 类型（必须 VARCHAR(64)）
- 禁止在 Controller 写业务逻辑
- 禁止前端硬编码 API 地址
- 禁止使用 Options API
- 禁止在 uni-app 中使用 `px` 单位（必须 `rpx`）
- 禁止悬浮/绝对定位的按钮（按钮紧跟内容下方）
