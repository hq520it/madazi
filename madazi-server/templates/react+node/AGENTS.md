# React + Node.js (Express) 模板规范

## 预览环境拓扑（禁止改偏，最高优先级）

项目在平台里不是本机跑服务，预览流量链路固定，**改动任何一环都会 404 / 连不上**：

```
浏览器 → pv-xxx.<YOUR-DOMAIN>.com（或主站 /api/projects/{id}/preview-proxy/）
  → 平台 server 反代（路径透传）
  → 预览容器 Vite dev server（base = /api/projects/{id}/preview-proxy，由 VITE_BASE 注入）
  → Vite proxy 把「带 base 前缀的 /api 请求」rewrite 后转发到后端 3001
```

铁律（违反 = 预览 404）：
- ★ 前端 API 请求必须带 base 前缀：`fetch(import.meta.env.BASE_URL + 'api/...')`（axios 用 baseURL=import.meta.env.BASE_URL + 相对 url 'api/...'）
- ★ 禁止写死 `/api/...` 绝对路径（预览下命中不了 Vite proxy）；禁止相对路径 `./api`（pv 子域名页面 URL 是根路径，解析后仍不带 base）
- ★ 禁止 `http://localhost:3001` / IP 硬编码后端地址
- ★ 禁止改动 `vite.config.*` 的 `base` / `proxy` / `server.hmr` 结构（base 由平台 VITE_BASE 注入，hmr 必须关闭）
- ★ 禁止改后端监听端口（固定 3001）

## 技术栈
- 前端：React 18 + Vite 6 + TypeScript
- 后端：Node.js + Express 4 + TypeScript
- 数据库：PostgreSQL 16（预览容器内置 localhost:5432/appdb，用户 postgres 无密码）
- pgcrypto 扩展已安装（提供 gen_random_uuid()）
- 主键：UUID 字符串（VARCHAR(36)），DEFAULT gen_random_uuid()
- pg 库连接，连接字符串 postgres://postgres@localhost:5432/appdb

## 目录结构
```
backend/
  package.json
  tsconfig.json
  src/
    index.ts          # Express 启动入口
    db.ts             # 数据库连接
    routes/
      items.ts        # Item CRUD 范例
    middleware/
      auth.ts         # JWT 认证中间件
frontend/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx          # React 入口
    App.tsx           # 路由配置
    api.ts            # API 调用封装
    pages/
      Home.tsx        # 首页 + Item CRUD 范例
```

## 规范
1. 后端必须用 Express Router 组织路由
2. Entity 模型用 TypeScript interface 定义
3. 所有 API 返回 JSON，统一错误格式 { error: string }
4. 前端用 fetch 调用 API，不使用 mock 数据
5. UUID 主键，不使用自增 ID
6. CORS 已在 index.ts 中配置
7. 后端端口 3001，前端 Vite 代理 /api 到后端
