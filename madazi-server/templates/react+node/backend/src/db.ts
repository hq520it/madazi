import pg from 'pg';

// PostgreSQL 连接池
// 预览容器内置 PostgreSQL 16：localhost:5432/appdb，用户 postgres 无密码
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/appdb',
});

// 初始化表结构（启动时执行）
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
