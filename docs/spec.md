# 码搭子 (madazi) — 产品规格说明

> 版本：0.1.0 | 日期：2026-07-16
> 品牌：gefangmian 子产品 | 路径：~/code/madazi

---

## 1. 产品定位

**一句话：** 可私有化部署的 AI 应用搭建平台。企业装在自己服务器上，员工用自然语言描述需求，AI 基于模板生成可上线的应用代码，代码完全可见可控。

**不是什么：**
- 不是 SaaS。不是 Bolt/Lovable/v0 那种托管在云端的生成器。
- 不是低代码拖拽平台。不靠拖组件，靠 AI 生成。
- 不是妙搭。妙搭是 SaaS，码搭子是私有化。

**是什么：**
- 一套装在企业内网的软件，企业配自己的 LLM API key，AI 生成的应用跑在企业内网，代码归企业所有。

---

## 2. 目标用户

| 角色 | 场景 |
|------|------|
| 企业 IT 团队 | 内部工具需求多、开发人手不够，用平台快速生成应用骨架 |
| IT 负责人/CTO | 要求数据不出内网、代码可控、能审计 |
| 非技术人员 | 有想法但不会写代码，描述需求让 AI 生成可运行的应用 |

---

## 3. 核心流程

```
用户描述需求
    ↓
[表单] 选技术栈 + 应用类型 + 功能模块
    ↓
[AI] 基于模板生成项目骨架 + 业务代码
    ↓
[对话] 用户追问/调整，AI 增量修改代码
    ↓
[预览] 在线预览生成效果
    ↓
[下载/部署] 打包代码下载 或 一键部署到企业服务器
```

### 3.1 需求输入

**表单定框架：**
- 应用类型：Web 应用 / 微信小程序 / 企业内部工具 / 纯前端页面
- 技术栈：React + Spring Boot / uni-app + Spring Boot / React + Node.js / 纯前端
- 功能模块勾选：用户管理 / 权限控制 / CRUD 表单 / 数据报表 / 文件上传 / 支付 / 消息通知 / AI 集成
- 需求描述：自由文本，说清楚要做什么

**对话调细节：**
- AI 生成后，用户通过对话调整："加一个导出 Excel"、"登录改成手机验证码"
- AI 增量修改已有代码，不是重新生成

### 3.2 模板系统

**三层模板来源：**

| 层级 | 来源 | 说明 |
|------|------|------|
| 内置模板 | GitHub 开源项目筛选集成 | 预置行业模板（CRM、OA、预约、商城等），开箱即用 |
| 企业模板 | 导入企业现有项目代码 | 平台分析代码结构、技术栈、编码风格，生成企业专属模板 |
| AI 生成 | 无现成模板时 | AI 从零生成项目骨架，遵循所选技术栈规范 |

**模板包含：**
- 项目目录结构
- 编码规范约束（AGENTS.md / .cursorrules）
- 技术栈配置（package.json / pom.xml）
- 基础页面布局
- 认证/权限骨架
- 数据库初始化脚本

### 3.3 代码生成

**生成策略：**

1. **不是从零生成。** 先匹配模板，在模板基础上填充业务逻辑。
2. **模板有约束。** 每个模板带 AGENTS.md 规范文件，AI 必须遵循其中的编码约定、目录结构、命名规范。
3. **生成后可预览。** 平台内置容器化预览环境，生成的项目自动启动，用户直接在浏览器看效果。
4. **可增量修改。** 用户对话提调整需求，AI 只改涉及的部分，不重写整个项目。

**质量保障：**
- 生成的代码必须能编译通过
- 生成的代码必须能启动运行
- 生成的代码结构符合模板规范
- 代码有基本注释

### 3.4 在线预览

- 平台内置 Docker 预览环境
- 前端项目：自动 `npm install && npm run dev`，代理到浏览器
- 后端项目：自动启动，提供 API 文档
- 小程序项目：提供二维码或微信开发者工具导入指引
- 预览环境隔离，互不影响

### 3.5 下载与部署

- **下载：** 一键打包整个项目源码（zip）
- **部署：** 支持一键部署到企业指定服务器（Docker Compose）
- **源码归属：** 生成的代码完全归企业所有，无加密无锁定

---

## 4. 技术架构

### 4.1 平台自身架构

```
┌─────────────────────────────────────────┐
│  码搭子平台                               │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 前端界面  │  │ 后端服务  │  │ 预览引擎│ │
│  │ React    │  │ Node.js  │  │ Docker │ │
│  │ Vite     │  │ Express  │  │        │ │
│  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │             │             │      │
│  ┌────┴─────────────┴─────────────┴───┐  │
│  │          AI 代码生成引擎             │  │
│  │  (适配多 LLM: 通义/DeepSeek/OpenAI)  │  │
│  └────────────────┬───────────────────┘  │
│                   │                      │
│  ┌────────────────┴───────────────────┐  │
│  │          模板管理系统                │  │
│  │  内置模板 / 企业模板 / AI 生成       │  │
│  └────────────────────────────────────┘  │
│                                          │
└─────────────────────────────────────────┘
        │                    │
   企业 LLM API         企业服务器
   (自配 key)          (部署目标)
```

### 4.2 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 平台前端 | React 19 + Vite | 你最熟，生态最好 |
| 平台后端 | Node.js + Express | 轻量，文件操作和流式 API 顺手 |
| AI 引擎 | 多 LLM 适配层 | 企业自配 key，适配通义/DeepSeek/OpenAI/Azure |
| 预览引擎 | Docker | 隔离环境，支持多技术栈项目 |
| 模板存储 | 本地文件系统 + Git | 简单直接，企业内网不需要复杂存储 |
| 数据库 | PostgreSQL | 生产级，私有化部署用 docker-compose 拉起 |

### 4.3 LLM 适配层

企业配置自己的 API key，平台支持：

| LLM | API 格式 | 备注 |
|-----|---------|------|
| DeepSeek | OpenAI 兼容 | 国内首选，便宜快 |
| 通义千问 | OpenAI 兼容 | 阿里云生态 |
| OpenAI / Azure | OpenAI 原生 | 外企/有合规通道的 |
| 本地模型 | OpenAI 兼容 | Ollama / vLLM，完全离线 |

统一适配为 OpenAI 格式，用 `baseURL + apiKey + model` 三元组配置。

---

## 5. MVP 范围

### 5.1 MVP 做（v0.1）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 需求输入界面 | P0 | 表单：选技术栈+应用类型+功能模块+需求描述 |
| AI 生成项目骨架 | P0 | 调 LLM，基于模板生成可运行的项目代码 |
| 代码在线查看 | P0 | 生成后能看到目录结构和文件内容 |
| 打包下载 | P0 | zip 打包整个项目源码 |
| LLM 配置 | P0 | 配置 API key、baseURL、model |
| 1 套内置模板 | P0 | React + Spring Boot（CRUD 应用模板） |

### 5.2 MVP 不做（后续版本）

| 功能 | 版本 | 原因 |
|------|------|------|
| 在线预览（Docker） | v0.2 | 复杂度高，先靠下载验证 |
| 对话式增量修改 | v0.2 | 需要代码 diff 能力 |
| 企业项目导入分析 | v0.3 | 需要代码分析引擎 |
| 多模板管理 | v0.3 | 先一套跑通 |
| 可视化编辑器 | v0.4 | 开发量最大 |
| 用户权限系统 | v0.3 | MVP 单用户即可 |
| uni-app 模板 | v0.2 | 第二套模板 |
| Node.js 模板 | v0.3 | 第三套模板 |
| 一键部署 | v0.3 | 需要 SSH 到目标服务器 |

---

## 6. 数据模型

```sql
-- 项目
CREATE TABLE projects (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tech_stack TEXT NOT NULL,      -- "react+springboot" | "uniapp+springboot" | ...
  app_type TEXT NOT NULL,        -- "web" | "miniapp" | "internal" | "frontend"
  status TEXT DEFAULT 'draft',   -- "draft" | "generating" | "generated" | "deployed"
  source_path TEXT,              -- 生成代码的本地路径
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- LLM 配置
CREATE TABLE llm_configs (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 生成记录
CREATE TABLE generations (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  prompt TEXT NOT NULL,          -- 发给 LLM 的完整 prompt
  response TEXT,                 -- LLM 返回的完整内容
  status TEXT DEFAULT 'pending', -- "pending" | "success" | "failed"
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 7. API 设计

```
# LLM 配置
GET    /api/llm/configs          # 列出所有 LLM 配置
POST   /api/llm/configs          # 新增 LLM 配置
PUT    /api/llm/configs/:id      # 更新配置
DELETE /api/llm/configs/:id      # 删除配置

# 项目
GET    /api/projects              # 项目列表
POST   /api/projects              # 创建项目（触发 AI 生成）
GET    /api/projects/:id          # 项目详情
GET    /api/projects/:id/files    # 项目文件树
GET    /api/projects/:id/files/*  # 读取文件内容
DELETE /api/projects/:id          # 删除项目

# 生成
POST   /api/projects/:id/generate # 触发 AI 生成
GET    /api/projects/:id/generations  # 生成记录

# 下载
GET    /api/projects/:id/download # 下载项目 zip

# 模板
GET    /api/templates             # 模板列表
```

---

## 8. 目录结构

```
~/code/madazi/
├── README.md
├── package.json
├── madazi-server/          # Node.js 后端
│   ├── src/
│   │   ├── index.js        # 入口
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务逻辑
│   │   │   ├── llm.js      # LLM 适配层
│   │   │   ├── generator.js # 代码生成引擎
│   │   │   └── template.js # 模板管理
│   │   ├── db/             # SQLite
│   │   └── utils/
│   └── package.json
├── madazi-web/             # React 前端
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Home.tsx    # 首页/项目列表
│   │   │   ├── Create.tsx  # 创建项目（表单+生成）
│   │   │   ├── Project.tsx # 项目详情（代码查看）
│   │   │   └── Settings.tsx # LLM 配置
│   │   ├── components/
│   │   └── api/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
└── templates/              # 内置模板库
    └── react-springboot/   # 第一套模板
        ├── AGENTS.md       # AI 编码规范约束
        ├── frontend/       # React 前端骨架
        └── backend/        # Spring Boot 后端骨架
```

---

## 9. 商业化方向（MVP 后再想）

| 模式 | 说明 |
|------|------|
| 私有化部署授权 | 按年收费，企业部署在自己服务器 |
| 模板市场 | 行业模板付费，开发者上传分成 |
| 企业定制服务 | 基于平台做定制开发（回归工作室模式） |
| 开源社区版 + 商业版 | 社区版免费引流，企业版收费（高级模板、企业项目导入、SSO） |

---

## 10. 风险

| 风险 | 应对 |
|------|------|
| AI 生成代码质量不稳定 | 模板约束 + 编译验证 + 生成后自动测试 |
| LLM API 成本由企业承担 | 明确告知，支持本地模型（Ollama）降低成本 |
| 模板维护成本高 | MVP 只做一套，验证后再扩 |
| 竞品抄袭 | 私有化 + 企业模板导入是差异化壁垒 |
| 一个人开发周期长 | MVP 砍到最小，先跑通生成→下载流程 |
