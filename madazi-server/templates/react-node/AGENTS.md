# React + Node.js (Express) 项目编码规范

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
- ★ 前端 API 请求必须带 base 前缀：`fetch(import.meta.env.BASE_URL + 'api/...')`（BASE_URL 预览下 = /api/projects/{id}/preview-proxy/，本地 dev = /）
- ★ 禁止写死 `/api/...` 绝对路径（预览下命中不了 Vite proxy）；禁止相对路径 `./api`（pv 子域名页面 URL 是根路径，解析后仍不带 base）
- ★ 禁止 `http://localhost:3001` / IP 硬编码后端地址
- ★ 禁止改动 `vite.config.js` 的 `base` / `proxy` / `server.hmr` 结构（base 由平台 VITE_BASE 注入，hmr 必须关闭）
- ★ 禁止改后端监听端口（固定 3001）

## 项目结构

```
frontend/
├── src/
│   ├── pages/           # 页面组件
│   ├── components/      # 可复用组件
│   ├── api/             # API 调用
│   ├── hooks/           # 自定义 Hooks
│   └── main.tsx         # 路由入口
├── vite.config.js
├── tsconfig.json
└── package.json

backend/
├── src/
│   ├── routes/          # Express 路由（按资源分文件）
│   ├── middleware/      # 中间件
│   ├── db.js            # PostgreSQL 连接 + 初始化
│   └── index.js         # 应用入口
└── package.json
```

## 后端规范

- Node.js 18+，Express 4
- ES Modules（`"type": "module"`，import/export）
- 数据库主键：UUID v4 字符串（VARCHAR(36)），默认值 gen_random_uuid()
- 数据库：PostgreSQL 16（pg npm 包，pgcrypto 扩展已安装）
- 数据库连接：`postgres://postgres@localhost:5432/appdb`（预览容器内置，无密码）
- 路由按资源分文件（Express 路由分文件），挂在 `src/routes/<resource>.js`
- 路由统一挂在 `/api/<resource>` 前缀下
- 入口 `src/index.js` 用 `app.use('/api/items', itemsRouter)` 组装
- 错误处理用统一中间件，返回 `{ "code": 500, "message": "..." }`
- 成功响应格式：`{ "code": 200, "data": ..., "message": "success" }`
- 时间字段用 TIMESTAMPTZ，数据库层 `DEFAULT NOW()`

## 前端规范

- React 19 + TypeScript + Vite
- 路由用 react-router-dom v7
- API 调用统一封装在 `src/api/` 下
- 组件用函数式组件 + Hooks
- 样式用 CSS Modules 或内联样式，不用 CSS-in-JS
- 表单受控组件
- 列表页统一分页 + 搜索
- ★ 前端 API 请求必须带 base 前缀：`fetch(import.meta.env.BASE_URL + 'api/...')`（BASE_URL 预览下 = /api/projects/{id}/preview-proxy/）
- 禁止写死 `/api/...` 绝对路径——预览环境 base 非根，绝对 /api 命中不了 Vite proxy 会 404（本地 dev base='/' 时 BASE_URL 前缀同样成立）

## 数据库

- PostgreSQL 16（预览容器内置 localhost:5432/appdb，用户 postgres 无密码）
- pgcrypto 扩展已安装（提供 gen_random_uuid()）
- 表名蛇形命名：user_account, order_detail
- 字段名蛇形命名：created_at, updated_at
- 每张表必须有：id (VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()), created_at (TIMESTAMPTZ DEFAULT NOW()), updated_at (TIMESTAMPTZ DEFAULT NOW())
- 建表语句在 `src/db.js` 的 `initDb()` 中启动时执行

## API 设计

- RESTful 风格
- `GET /api/resources` - 列表
- `GET /api/resources/:id` - 详情
- `POST /api/resources` - 创建
- `PUT /api/resources/:id` - 更新
- `DELETE /api/resources/:id` - 删除
- 列表接口支持 `?page=0&size=20&search=xxx`

## 禁止

- 禁止使用自增整数主键
- 禁止把业务逻辑写进 `index.js` 入口
- 禁止前端硬编码后端地址（必须走 Vite proxy）
- 禁止使用 `var` 声明变量
- 禁止使用 CommonJS（require/module.exports）
