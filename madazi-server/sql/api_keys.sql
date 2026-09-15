-- S2-2: 平台 per-user key 签发/鉴权表
-- key 明文 mz-<32hex> 只在签发时展示一次；sha256 哈希存储
CREATE TABLE IF NOT EXISTS api_keys (
  id          varchar(64) PRIMARY KEY,
  user_id     varchar(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT '',
  key_hash    text NOT NULL UNIQUE,           -- sha256(key)
  key_prefix  varchar(16) NOT NULL DEFAULT '', -- 前 8 位展示用 mz-xxxxxx
  status      varchar(20) NOT NULL DEFAULT 'active',  -- active|revoked
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
