import pg from 'pg';

// PostgreSQL 连接池
// 预览容器内置 PostgreSQL 16：localhost:5432/appdb，用户 postgres 无密码
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/appdb',
});

// 初始化表结构（启动时执行）
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS item (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Promise 化查询方法，兼容路由中以 ? 占位符书写的 SQL（自动转换为 $N）
export function all(sql, params = []) {
  return pool.query(toPgSql(sql), params).then(r => r.rows);
}

export function get(sql, params = []) {
  return pool.query(toPgSql(sql), params).then(r => r.rows[0]);
}

export function run(sql, params = []) {
  return pool.query(toPgSql(sql), params).then(() => undefined);
}

// 将 SQLite 风格的 ? 占位符转换为 PostgreSQL 的 $N 占位符
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export { pool };
export default pool;
