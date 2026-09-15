# Vue 3 + Node.js (Express) 项目编码规范

> AI 生成代码时必须严格遵循以下规范。

## 预览环境拓扑（禁止改偏，最高优先级）

项目在平台里不是本机跑服务，预览流量链路固定，**改动任何一环都会 404 / 连不上**：

```
浏览器 → pv-xxx.<YOUR-DOMAIN>.com（或主站 /api/projects/{id}/preview-proxy/）
  → 平台 server 反代（路径透传）
  → 预览容器 Vite dev server（base = /api/projects/{id}/preview-proxy，由 VITE_BASE 注入）
  → Vite proxy 把「带 base 前缀的 /api 请求」rewrite 后转发到后端 3001
```

铁律（违反 = 预览 404）：
- ★ 前端 API 请求必须带 base 前缀：axios `baseURL = import.meta.env.BASE_URL` + 相对 url `'api/items'`（不带前导 /）
- ★ 禁止写死 `/api/...` 绝对路径（预览下命中不了 Vite proxy）；禁止相对路径 `./api`（pv 子域名页面 URL 是根路径，解析后仍不带 base）
- ★ 禁止 `http://localhost:3001` / IP 硬编码后端地址
- ★ 禁止改动 `vite.config.*` 的 `base` / `proxy` / `server.hmr` 结构（base 由平台 VITE_BASE 注入，hmr 必须关闭）
- ★ 禁止改后端监听端口（固定 3001）

## 项目结构

```
frontend/
├── src/
│   ├── pages/           # 页面组件
│   ├── components/      # 可复用组件
│   ├── api/             # API 调用
│   ├── composables/     # 组合式函数
│   ├── router/          # vue-router 配置
│   ├── App.vue
│   └── main.ts
├── vite.config.js
└── package.json

backend/
├── src/
│   ├── routes/          # Express 路由
│   ├── middleware/
│   ├── db.js            # PostgreSQL 连接
│   └── index.js         # 入口
└── package.json
```

## 后端规范

- Node.js 18+，Express 4
- ES Modules（`"type": "module"`，import/export）
- 数据库主键：UUID v4 字符串（VARCHAR(36)），默认值 gen_random_uuid()
- 数据库：PostgreSQL 16（pg npm 包，pgcrypto 扩展已安装）
- 数据库连接：`postgres://postgres@localhost:5432/appdb`（预览容器内置，无密码）
- 路由按资源分文件，挂在 `/api/<resource>` 前缀
- 错误处理统一中间件，返回 `{ code: 500, message: "..." }`
- 成功响应：`{ code: 200, data: ..., message: "success" }`
- 时间字段用 TIMESTAMPTZ，数据库层 `DEFAULT NOW()`

## 前端规范

- Vue 3 + TypeScript + Vite
- 组件统一 `<script setup lang="ts">`，禁止 Options API
- 路由用 vue-router 4
- API 调用统一封装在 `src/api/`
- 状态管理用 pinia（按需）
- 表单用 `v-model` 受控绑定
- 禁止前端硬编码 API 地址（走 Vite proxy）

## 数据库

- PostgreSQL 16（预览容器内置 localhost:5432/appdb，用户 postgres 无密码）
- pgcrypto 扩展已安装，UUID 用 gen_random_uuid()
- 表名蛇形命名
- 字段名蛇形命名
- 每张表必须有：id (VARCHAR(36) UUID)、created_at (TIMESTAMPTZ)、updated_at (TIMESTAMPTZ)

## API 设计

- RESTful 风格
- `GET /api/resources` - 列表
- `GET /api/resources/:id` - 详情
- `POST /api/resources` - 创建
- `PUT /api/resources/:id` - 更新
- `DELETE /api/resources/:id` - 删除

## 禁止

- 禁止使用自增整数主键
- 禁止 CommonJS（require/module.exports）
- 禁止 Vue Options API
- 禁止前端硬编码 API 地址
- 禁止 `var` 声明变量
