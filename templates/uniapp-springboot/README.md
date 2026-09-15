# uni-app + Spring Boot 模板

可运行的最小项目脚手架（小程序 + 后端）。AI 生成代码时拷贝此目录，再补业务文件。

## 启动

```bash
# 后端
cd backend
./mvnw spring-boot:run          # 监听 http://localhost:8080/api

# 前端
cd frontend
npm install
npm run dev:mp-weixin           # 微信小程序，用 HBuilderX 或微信开发者工具打开 dist/dev/mp-weixin
# 或
npm run dev:h5                  # H5 调试
```

## 默认接口

后端 context-path 为 `/api`，前端 `uni.request` baseURL 默认 `http://localhost:8080/api`。

- `GET    /api/items`        列表
- `GET    /api/items/:id`    详情
- `POST   /api/items`        创建
- `PUT    /api/items/:id`    更新
- `DELETE /api/items/:id`    删除

数据库表 `item` 由 JPA `ddl-auto: update` 自动创建。

## 前端调试说明

- H5 调试时同源策略由后端 `CorsConfig` 放开
- 小程序调试时，需在微信开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名」
- 生产环境需在小程序后台配置 request 合法域名
