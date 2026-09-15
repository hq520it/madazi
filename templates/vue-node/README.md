# Vue + Node.js (Express) 模板

最小可运行脚手架：Vue 3 + Vite 前端 + Node.js Express + SQLite 后端。

## 启动

```bash
# 后端
cd backend
npm install
npm run dev    # 默认 3000 端口

# 前端
cd frontend
npm install
npm run dev    # 默认 5173，自动 proxy /api -> 3000
```

## 默认接口

- `GET /api/items` 列表
- `POST /api/items` 创建
- `PUT /api/items/:id` 更新
- `DELETE /api/items/:id` 删除

## 数据库

SQLite，启动自动建表。数据文件 `backend/data/app.db`（运行时生成）。
