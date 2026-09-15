import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { db } from '../db/init.js';

// 初始化默认管理员账号（私有化部署：硬编码 admin / admin123）
export async function initAdmin() {
  const username = 'admin';
  const password = 'admin123';

  const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (rows.length > 0) {
    return; // 管理员已存在
  }

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 10);
  await db.query(
    'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
    [id, username, passwordHash, 'admin']
  );
  console.log(`[initAdmin] Default admin created: ${username} (change password ASAP)`);
}
