import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://madazi:madazi_dev_2026@localhost:5432/madazi';
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code VARCHAR(32) PRIMARY KEY,
  created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  used_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tech_stack TEXT NOT NULL,
  app_type TEXT NOT NULL,
  modules TEXT,
  status TEXT DEFAULT 'draft',
  source_path TEXT,
  source_type VARCHAR(10) DEFAULT 'template',
  owner_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  is_shared BOOLEAN DEFAULT FALSE,
  build_status VARCHAR(20) DEFAULT 'pending',
  build_errors TEXT,
  prd_doc TEXT,
  plan_doc TEXT,
  ai_mode VARCHAR(20) DEFAULT 'dsh',  -- AI 任务模式：dsh（DeepSeek Harness，唯一；2026-08-19 自研链已删）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llm_configs (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  api_type VARCHAR(20) DEFAULT 'openai',  -- openai | anthropic
  is_default BOOLEAN DEFAULT FALSE,
  context_length INTEGER DEFAULT 64000,  -- 上下文窗口（token）
  max_tokens INTEGER DEFAULT 16000,  -- 单次生成上限（token）
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generations (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  response TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('preview_idle_timeout', '86400'),
  ('preview_max_per_user', '3'),
  ('preview_cpu_limit', '1'),
  ('preview_memory_limit', '2048'),
  ('preview_global_max', '20')
ON CONFLICT (key) DO NOTHING;

-- 会话（每个项目可以有多个会话，每个会话独立保存上下文）
CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  last_message TEXT,
  parent_conv_id VARCHAR(64), -- fork 来源会话
  fork_msg_id VARCHAR(64), -- fork 点消息
  is_fork BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会话消息（会话内的对话历史，user/ai 角色交替）
CREATE TABLE IF NOT EXISTS conversation_messages (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- user / ai / system
  content TEXT NOT NULL,
  task_id VARCHAR(64), -- 关联的任务 ID（用户发送的消息生成任务，ai 消息引用任务结果）
  status VARCHAR(20), -- pending / running / completed / failed / cancelled
  commit_hash VARCHAR(64),
  modified_files TEXT, -- JSON string
  error TEXT,
  engine VARCHAR(10), -- dsh / self：AI 回复由哪个引擎执行（NULL=旧消息未知）
  user_id VARCHAR(64), -- ★ 发送者用户 ID（仅 role=user 时有值）
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);

-- 项目成员（协同开发）
CREATE TABLE IF NOT EXISTS project_members (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'developer',  -- admin | developer
  added_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_pm_user ON project_members(user_id);

-- 全局技能库（用户分享的技能，可被任何项目安装）
CREATE TABLE IF NOT EXISTS skills (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100),  -- ★ DSH 触发名（kebab-case，^[a-z0-9]+(?:-[a-z0-9]+)*$）；中文名仅作展示
  description TEXT,
  icon VARCHAR(50) DEFAULT 'sparkles',
  color VARCHAR(20) DEFAULT '#5E6AD2',
  prompt TEXT NOT NULL,
  category VARCHAR(50) DEFAULT 'general',
  author_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(100),
  is_builtin BOOLEAN DEFAULT FALSE,  -- ★ 官方内置常用技能：启动同步到 $DSH_HOME/skills，全项目免安装
  install_count INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skills_public ON skills(is_public);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

-- License 授权（单部署一份，保留最新激活记录）
CREATE TABLE IF NOT EXISTS licenses (
  id VARCHAR(64) PRIMARY KEY,
  license_key TEXT NOT NULL,
  plan TEXT,
  seats INTEGER,
  expires_at TIMESTAMPTZ,
  domain TEXT,
  issued_to TEXT,
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====== 用量计量（P0-2） ======

-- LLM 调用用量日志（每次调用一条）
CREATE TABLE IF NOT EXISTS usage_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  project_id VARCHAR(64) REFERENCES projects(id) ON DELETE SET NULL,
  config_id VARCHAR(64),
  model VARCHAR(100),
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_project_time ON usage_logs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_logs(created_at);

-- 模型单价（官方币种 + 官方价；后台可改；无官方价的模型不估算成本）
CREATE TABLE IF NOT EXISTS model_costs (
  model VARCHAR(100) PRIMARY KEY,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  input_price_per_m NUMERIC(12,6) NOT NULL DEFAULT 0,
  output_price_per_m NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 种子：官方币种 + 官方定价（2026-08-11 官方定价页逐一核实）
-- deepseek ×2 / glm ×2 / qwen ×2 = 官方定价页 CNY 价（百万 tokens，基础档）
-- kimi/doubao/gpt/claude 官方价格页 JS 渲染抓取失败 → 不写未核实价，
-- 由管理端「模型价格」页核对后配置（未定价模型 cost_usd=0，不估算）
INSERT INTO model_costs (model, currency, input_price_per_m, output_price_per_m) VALUES
  ('deepseek-v4-flash', 'CNY', 1.00, 2.00),
  ('deepseek-v4-pro', 'CNY', 3.00, 6.00),
  ('glm-5.2', 'CNY', 8.00, 28.00),
  ('glm-5.1', 'CNY', 6.00, 24.00),
  ('qwen3-coder', 'CNY', 4.00, 16.00),
  ('qwen3.7-plus', 'CNY', 2.00, 8.00)
ON CONFLICT (model) DO NOTHING;

-- 用户每日配额覆盖（NULL = 用全局默认 settings.daily_tokens_limit）
CREATE TABLE IF NOT EXISTS user_quotas (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_tokens_limit INTEGER, -- NULL=全局默认；0=不限
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====== 模板市场（doc/2026-08-23-模板市场设计.md） ======

-- 模板主表：一个 slug 一条，版本见 template_versions
CREATE TABLE IF NOT EXISTS templates (
  id VARCHAR(64) PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  app_type TEXT DEFAULT 'web',
  author_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  source_type VARCHAR(20) NOT NULL DEFAULT 'user',   -- official（内置目录同步） | user（项目发布）
  origin_project_id VARCHAR(64),                     -- 发布来源项目（可追溯）
  visibility VARCHAR(20) NOT NULL DEFAULT 'private', -- private（仅作者） | public（需审核）
  category VARCHAR(50) DEFAULT 'fullstack',          -- fullstack | miniapp | admin | library
  tags TEXT DEFAULT '[]',                            -- JSON 数组字符串（与 projects.modules 同风格）
  icon VARCHAR(8),                                   -- 卡片 2 字母缩写
  status VARCHAR(20) NOT NULL DEFAULT 'draft',       -- draft | pending | published | rejected | archived
  latest_version TEXT,
  download_count INTEGER DEFAULT 0,
  rating_avg NUMERIC(3,2) DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);

-- 模板版本：每个 semver 一条；pkg_path 为 NULL 表示官方目录模板（安装直接拷贝）
CREATE TABLE IF NOT EXISTS template_versions (
  id VARCHAR(64) PRIMARY KEY,
  template_id VARCHAR(64) NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  changelog TEXT,
  readme TEXT,                                       -- 发布时从项目 README 抽取，详情页渲染
  pkg_path TEXT,                                     -- zip 路径（generated/.market-packages 下，内容寻址）
  pkg_size BIGINT,
  pkg_sha256 TEXT,
  file_count INTEGER,
  tech_stack TEXT,                                   -- 透传来源项目 tech_stack，保证预览/构建链路兼容
  status VARCHAR(20) NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  review_note TEXT,
  reviewed_by VARCHAR(64),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS idx_tpl_versions_template ON template_versions(template_id);

-- 模板评分（一人一模板一条，upsert）
CREATE TABLE IF NOT EXISTS template_ratings (
  template_id VARCHAR(64) NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (template_id, user_id)
);
`;

export async function initDb() {
  const client = await pool.connect();
  await client.query(SCHEMA);

  // 用量配额全局默认设置
  try {
    await client.query(`INSERT INTO settings (key, value) VALUES
      ('daily_tokens_limit', '0'),
      ('usage_default_input_price', '0.5'),
      ('usage_default_output_price', '1.5')
      ON CONFLICT (key) DO NOTHING`);
  } catch (err) {
    console.error('初始化用量设置失败:', err);
  }

  // 迁移：为已有 projects 表加列（IF NOT EXISTS 不支持，用 try-catch）
  try {
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE');
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_status VARCHAR(20) DEFAULT 'pending'");
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS build_errors TEXT');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS prd_doc TEXT');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_doc TEXT');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_mode VARCHAR(20) DEFAULT \'dsh\'');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS brainstorm_skipped BOOLEAN DEFAULT FALSE');
    // ★ P2 B4：projects.llm_config_id 列缺失——PUT 更新该字段时 SQL 报 column does not exist → 500
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS llm_config_id VARCHAR(64) REFERENCES llm_configs(id) ON DELETE SET NULL');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ');
    // ★ 老库补列：source_type 在 SCHEMA 内但早期建库无此列（import-zip / 模板市场安装均写入该列）
    await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_type VARCHAR(10) DEFAULT 'template'");
    await client.query("ALTER TABLE llm_configs ADD COLUMN IF NOT EXISTS api_type VARCHAR(20) DEFAULT 'openai'");
    await client.query('ALTER TABLE llm_configs ADD COLUMN IF NOT EXISTS context_length INTEGER DEFAULT 64000');
    await client.query('ALTER TABLE llm_configs ADD COLUMN IF NOT EXISTS max_tokens INTEGER DEFAULT 16000');
    // ★ 模型归属隔离：NULL=全局（管理员配，全平台可用）；非空=用户私有（仅本人可见可用）→ 私有模型直连工作台
    await client.query('ALTER TABLE llm_configs ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE');
    await client.query('CREATE INDEX IF NOT EXISTS idx_llm_configs_user ON llm_configs(user_id)');
    await client.query('ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS user_id VARCHAR(64)');
    await client.query('ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS engine VARCHAR(10)');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS parent_conv_id VARCHAR(64)');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS fork_msg_id VARCHAR(64)');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_fork BOOLEAN DEFAULT FALSE');
    // ★ S2-2 key-server：平台 per-user key 表（幂等；老库自动补建）
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix VARCHAR(16) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)');
    // ★ dsh-web 多人元数据：会话创建人 + 消息发送人 + 项目会话排序模式
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS session_sort VARCHAR(20) DEFAULT \'time\'');
    // ★ 技能市场：DSH 触发名 slug（kebab-case；存量行待脚本回填）
    await client.query('ALTER TABLE skills ADD COLUMN IF NOT EXISTS slug VARCHAR(100)');
    // ★ 技能市场：官方内置标记（同步全局技能目录用）
    await client.query('ALTER TABLE skills ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN DEFAULT FALSE');
    await client.query(`
      CREATE TABLE IF NOT EXISTS dsh_session_owners (
        session_id VARCHAR(128) PRIMARY KEY,
        project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        active_user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_dsh_session_owners_project ON dsh_session_owners(project_id)');
    // ★ 2026-09-05 存量行补列：会话权限根跟随「最近活跃操作者」（防共享会话借归属者权限越权）
    await client.query('ALTER TABLE dsh_session_owners ADD COLUMN IF NOT EXISTS active_user_id VARCHAR(64)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS dsh_message_senders (
        rpc_id VARCHAR(128) PRIMARY KEY,
        session_id VARCHAR(128) NOT NULL,
        project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text_prefix TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_dsh_message_senders_session ON dsh_message_senders(session_id)');
    // ★ 三方登录（OAuth）：users 加头像/来源字段 + 三方身份绑定表（provider_user_id 唯一）
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT');
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'password'");
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_oauth_accounts (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(20) NOT NULL,
        provider_user_id TEXT NOT NULL,
        union_id TEXT,
        profile JSONB,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_user_id)
      )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_oauth_user ON user_oauth_accounts(user_id)');
  } catch (err) {
    // ★ P2-10 修复：原 catch 静默吞错，列添加失败（权限、表缺失、类型冲突）完全无痕，
    // 后续代码会在缺列时报莫名其妙的错。至少打日志暴露根因，避免把问题拖到运行时。
    console.error('[db-init] 迁移警告（非致命，继续启动）:', err.message);
  }

  client.release();
  console.log('Database initialized');
}

export { pool as db };
