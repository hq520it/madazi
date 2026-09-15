# Vue 3 + Spring Boot (Madazi) 项目编码规范

> 本项目基于 Madazi-Vue（Spring Boot 3 + MyBatis + PostgreSQL）与 Madazi-Vue3（Vue 3 + Element Plus）。
> AI 生成代码时必须严格遵循以下规范，与脚手架现有代码保持一致。

## 预览环境拓扑（禁止改偏，最高优先级）

项目在平台里不是本机跑服务，预览流量链路固定，**改动任何一环都会 404 / 连不上**：

```
浏览器 → pv-xxx.<YOUR-DOMAIN>.com（或主站 /api/projects/{id}/preview-proxy/）
  → 平台 server 反代（路径透传）
  → 预览容器 Vite dev server（base 由平台 VITE_BASE 注入）
  → Vite proxy 把「/api 请求」rewrite 后转发到后端 8080
```

铁律（违反 = 预览 404）：
- ★ 前端 API 一律走 `src/utils/request.js`（axios baseURL = VITE_APP_BASE_API，**勿改**），url 用相对 `'login'`（不带前导 /）
- ★ 禁止写死 `/api/...` 绝对路径、禁止相对路径 `./api`（pv 子域名页面 URL 是根路径，解析后仍不带 base）
- ★ 禁止 `http://localhost:8080` / IP 硬编码后端地址
- ★ 禁止改动 `vite.config.js` 的 `base` / `proxy` / `server.hmr` 结构（base 由平台 VITE_BASE 注入，hmr 必须关闭）
- ★ 禁止改后端端口 / context-path（固定 8080，context-path=/）

## 项目结构

```
backend/                                # 后端（多模块 Maven）
├── pom.xml                             # 父 pom（聚合 madazi-admin/common/framework/system）
├── madazi-admin/                        # 启动模块
│   └── src/main/java/com/madazi/
│       ├── MadaziApplication.java       # 启动类（com.madazi）
│       └── web/controller/**           # REST 控制器（com.madazi.web.controller）
├── madazi-common/                       # 通用模块（工具类 + 通用实体 SysUser/SysRole/SysDept/SysMenu）
├── madazi-framework/                    # 框架模块（security/config/aspect 等，一般不改）
├── madazi-system/                       # 系统业务模块
│   └── src/main/java/com/madazi/system/
│       ├── domain/**                   # 业务实体 POJO（继承 BaseEntity）
│       ├── mapper/**                   # MyBatis Mapper 接口
│       ├── service/                    # Service 接口（IXxxService）+ impl（XxxServiceImpl）
│       └── resources/mapper/**         # Mapper XML
└── sql/madazi_*.sql                        # 数据库初始化脚本

frontend/                               # 前端（Vue 3 + Vite + Element Plus）
├── src/
│   ├── api/                            # 后端接口封装（按模块分包）
│   ├── views/                          # 页面
│   ├── components/                     # 通用组件
│   ├── router/                         # vue-router 配置
│   ├── store/                          # pinia 状态
│   ├── utils/request.js                # axios 封装（baseURL = /api）
│   ├── main.js
│   └── App.vue
├── package.json
└── vite.config.js                      # dev 5173，proxy /api → 8080
```

## 后端规范（强制）

- Java 17 + Spring Boot 3 + **MyBatis** + PostgreSQL（**禁止 JPA / Spring Data**）
- **Java 包名固定 `com.madazi.*`**，禁止改成 `com.app` / `com.madazi` 或其它。
  - 业务实体：`com.madazi.system.domain`（通用实体如 SysUser 在 `com.madazi.common.core.domain.entity`）
  - Controller：`com.madazi.web.controller.<模块>`
  - Service 接口：`com.madazi.system.service.I<Name>Service`；实现：`com.madazi.system.service.impl.<Name>ServiceImpl`
  - Mapper 接口：`com.madazi.system.mapper.<Name>Mapper`；XML 放 `madazi-system/src/main/resources/mapper/<模块>/<Name>Mapper.xml`
- Controller 继承 `com.madazi.common.core.controller.BaseController`，用 `@RestController` + `@RequestMapping("/资源路径")`（**路径不带 /api 前缀**，context-path 是 `/`）
- 返回值：
  - 单对象/增删改 → `com.madazi.common.core.domain.AjaxResult`（`AjaxResult.success()` / `AjaxResult.success(data)` / `AjaxResult.error(msg)`）
  - 分页列表 → `com.madazi.common.core.page.TableDataInfo`（`getDataTable(list)`，含 rows + total）
- 分页参数用 `startPage()`（BaseController 提供），查询参数直接传实体对象
- 权限控制用 `@PreAuthorize("@ss.hasPermi('模块:资源:操作')")`，如 `system:user:list` / `system:user:add` / `system:user:edit` / `system:user:remove`
- **主键：字符串 UUID（VARCHAR(64)）**，应用层用 `com.madazi.common.utils.uuid.IdUtils.fastSimpleUUID()`（无连字符）或 `IdUtils.randomUUID()`（带连字符）生成；**禁止 BIGSERIAL / SERIAL / 自增整数主键**
- 实体继承 `com.madazi.common.core.domain.BaseEntity`（已含 createBy / createTime / updateBy / updateTime / remark 等公共字段，无需重复声明）
- Service 层写业务逻辑，Controller 只做参数接收与返回组装，禁止在 Controller 写业务逻辑
- 事务用 `@Transactional`（`org.springframework.transaction.annotation`）

## 前端规范（强制）

- Vue 3 + Vite + Element Plus + Pinia + vue-router，统一 `<script setup>` 组合式 API（禁止 Options API）
- 后端接口调用统一封装在 `src/api/` 下（按模块分包），用 `src/utils/request.js`（axios 实例）
- **请求一律走 `src/utils/request.js`**（axios baseURL = VITE_APP_BASE_API），url 用相对路径（不带 /api 前缀），禁止硬编码 `http://localhost:8080` 或 IP 地址（详见顶部「预览环境拓扑」）
- 页面放 `src/views/`，路由在 `src/router/` 注册；列表页统一分页 + 搜索
- 样式用 `<style scoped>`，禁止 CSS-in-JS

## 数据库（强制）

- **PostgreSQL**（驱动 `org.postgresql.Driver`）
- 数据库名 `madazi`（可通过环境变量 `PG_DB` 覆盖；连接参数 `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD`）
- **主键一律 `VARCHAR(64)` 存 UUID 字符串，禁止整数自增主键**
- 表名蛇形命名，Madazi 系统表带 `sys_` 前缀（如 `sys_user`）；新增业务表建议带业务前缀（如 `biz_`）
- 字段名蛇形命名：`user_id`、`created_at`；公共审计字段由 BaseEntity 映射（create_by / create_time / update_by / update_time / remark）
- 新增表需同步在 `sql/` 脚本中登记，并在菜单表 `sys_menu` 中登记对应菜单（否则前端看不到入口）

## API 设计约定

后端 Controller `@RequestMapping` 写资源名（不带 /api）；前端请求带 `/api` 前缀，由 Vite 代理转发。

- `GET /api/<资源>/list` → `TableDataInfo`（分页列表）
- `GET /api/<资源>/<id>` → `AjaxResult`（详情）
- `POST /api/<资源>` → `AjaxResult`（新增，`@RequestBody`）
- `PUT /api/<资源>` → `AjaxResult`（修改，`@RequestBody`）
- `DELETE /api/<资源>/<ids>` → `AjaxResult`（删除，多个 id 逗号分隔）

## 禁止

- **禁止使用 JPA / Spring Data JPA**（必须 MyBatis）
- **禁止使用 MySQL / MariaDB / SQLite / H2**（必须 PostgreSQL）
- **禁止整数自增主键**（必须 UUID VARCHAR(64)）
- 禁止改 Java 包名为非 `com.madazi`
- 禁止在 Controller 写业务逻辑（必须下沉到 Service）
- 禁止前端硬编码后端地址（统一 `/api` 相对路径）
- 禁止使用 Vue Options API（必须 `<script setup>`）
- 禁止引入新的 ORM/持久层框架（保持 MyBatis）
