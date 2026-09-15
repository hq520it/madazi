# React + Node.js 模板（管理后台）

前后端分离的管理后台脚手架：React 19 + TypeScript + MUI 9 + Vite 前端，Node.js (Express) + PostgreSQL 后端。
内置完整 RBAC：登录/登出、用户、角色、菜单、字典管理，外加示例业务 CRUD，开箱即用。

## 内置账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin | admin123 | 超级管理员（全部菜单/按钮权限） |
| demo | demo123 | 访客（仅仪表盘 + 示例业务，无按钮权限） |

## 启动

```bash
# 后端（端口固定 3001，依赖预览容器内置 PostgreSQL）
cd backend
pnpm install
pnpm dev

# 前端（另开一个终端，Vite 5173，/api 走 proxy 到后端 3001）
cd frontend
pnpm install
pnpm dev
```

## 目录结构

```
frontend/
├── src/
│   ├── api/            # 统一请求封装（request.ts 自带 BASE_URL 前缀 + Bearer Token）+ 各资源 API
│   ├── components/     # DataTable / FormDialog / SchemaForm / SearchForm / DictTag / HasPermission 等
│   ├── context/        # Auth / Dict / Snackbar / Theme 上下文
│   ├── hooks/          # usePageConfig（页面偏好：搜索条件/表格列配置跟随用户）
│   ├── layouts/        # AdminLayout（侧边菜单 + 顶栏）
│   └── pages/          # Login / Dashboard / system/(Users Roles Menus Dicts) / demo/Items
├── vite.config.js      # base 由平台 VITE_BASE 注入，proxy 转发后端 3001
└── package.json

backend/
├── src/
│   ├── routes/         # auth / users / roles / menus / dicts / preferences / dashboard / items
│   ├── middleware/     # Bearer Token 鉴权 + 权限码校验（requirePerm）
│   ├── utils/tree.js   # 菜单树构建
│   ├── db.js           # PostgreSQL 连接 + 建表 + 幂等种子数据（scrypt 密码散列）
│   └── index.js        # Express 入口（端口 3001）
└── package.json
```

## 默认接口（RESTful，统一 `{ code, data, message }` 响应）

- `POST /api/auth/login` / `GET /api/auth/me` / `POST /api/auth/logout`
- `/api/users` `/api/roles` `/api/menus` `/api/dicts`（列表支持 `?page=0&size=20&search=xxx`）
- `/api/preferences/:pageCode` 用户页面偏好存取
- `/api/dashboard/stats` 仪表盘统计
- `/api/items` 示例业务 CRUD

数据库为 PostgreSQL 16（预览容器内置 `localhost:5432/appdb`，用户 postgres 无密码），建表与种子数据由后端启动时幂等执行。
