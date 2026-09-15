# React + Spring Boot 模板

可运行的最小项目脚手架。AI 生成代码时拷贝此目录，再补业务文件。

## 启动

```bash
# 后端
cd backend
./mvnw spring-boot:run

# 前端
cd frontend
npm install
npm run dev
```

## 默认接口

- `GET /api/items` 列表
- `POST /api/items` 创建
- `PUT /api/items/:id` 更新
- `DELETE /api/items/:id` 删除

数据库表 `item` 由 JPA 自动创建。
