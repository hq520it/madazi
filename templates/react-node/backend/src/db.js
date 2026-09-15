import pg from 'pg';
import { randomBytes, scryptSync } from 'node:crypto';

// PostgreSQL 连接池
// 预览容器内置 PostgreSQL 16：localhost:5432/appdb，用户 postgres 无密码
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/appdb',
});

// ---------- 密码工具（scrypt 加盐散列，零依赖） ----------
export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(pw, salt, hash) {
  try {
    const h = scryptSync(pw, salt, 64);
    return h.equals(Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// ---------- 建表 ----------
async function createTables() {
  // 用户表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_account (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      nickname VARCHAR(64),
      email VARCHAR(128),
      phone VARCHAR(32),
      status VARCHAR(8) DEFAULT '1',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 角色表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(64) NOT NULL,
      description TEXT,
      status VARCHAR(8) DEFAULT '1',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 用户-角色关联
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_role (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(36) NOT NULL,
      role_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, role_id)
    )
  `);
  // 菜单/权限表（type='menu' 菜单 | 'button' 按钮，按钮行的 code 即权限码）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id VARCHAR(36),
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(64) NOT NULL,
      path VARCHAR(255),
      icon VARCHAR(64),
      sort INT DEFAULT 0,
      type VARCHAR(16) NOT NULL DEFAULT 'menu',
      status VARCHAR(8) DEFAULT '1',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 角色-菜单关联
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_menu (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      role_id VARCHAR(36) NOT NULL,
      menu_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (role_id, menu_id)
    )
  `);
  // 字典类型
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dict_type (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(64) NOT NULL,
      description TEXT,
      status VARCHAR(8) DEFAULT '1',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 字典项
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dict_item (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      type_code VARCHAR(64) NOT NULL,
      label VARCHAR(128) NOT NULL,
      value VARCHAR(128) NOT NULL,
      color VARCHAR(32),
      sort INT DEFAULT 0,
      status VARCHAR(8) DEFAULT '1',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 用户页面偏好（搜索条件/表格列配置跟着用户走的核心表）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preference (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(36) NOT NULL,
      page_code VARCHAR(64) NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, page_code)
    )
  `);
  // 登录会话
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_session (
      token VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 业务示例表（老库兼容：存在则补列）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS item (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      category VARCHAR(64),
      status VARCHAR(8) DEFAULT '1',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE item ADD COLUMN IF NOT EXISTS category VARCHAR(64)`);
  await pool.query(`ALTER TABLE item ADD COLUMN IF NOT EXISTS status VARCHAR(8) DEFAULT '1'`);
}

// ---------- 种子数据（幂等：仅空库写入） ----------
async function seed() {
  const rc = await pool.query('SELECT COUNT(*)::int AS c FROM role');
  if (rc.rows[0].c > 0) return;

  // 角色
  const roles = await pool.query(`
    INSERT INTO role (code, name, description) VALUES
      ('super_admin', '超级管理员', '拥有全部权限'),
      ('viewer', '访客', '仅浏览基础页面')
    RETURNING id, code
  `);
  const roleId = Object.fromEntries(roles.rows.map((r) => [r.code, r.id]));

  // 菜单 + 按钮权限（icon 对应 MUI 图标名）
  const menuDefs = [
    { code: 'dashboard', parent: null, name: '仪表盘', path: '/', icon: 'Dashboard', sort: 1 },
    { code: 'system', parent: null, name: '系统管理', path: '/system', icon: 'Settings', sort: 2 },
    { code: 'system:user', parent: 'system', name: '用户管理', path: '/system/users', icon: 'People', sort: 1 },
    { code: 'system:user:add', parent: 'system:user', name: '新增用户', type: 'button', sort: 1 },
    { code: 'system:user:edit', parent: 'system:user', name: '编辑用户', type: 'button', sort: 2 },
    { code: 'system:user:delete', parent: 'system:user', name: '删除用户', type: 'button', sort: 3 },
    { code: 'system:user:resetPwd', parent: 'system:user', name: '重置密码', type: 'button', sort: 4 },
    { code: 'system:role', parent: 'system', name: '角色管理', path: '/system/roles', icon: 'Security', sort: 2 },
    { code: 'system:role:add', parent: 'system:role', name: '新增角色', type: 'button', sort: 1 },
    { code: 'system:role:edit', parent: 'system:role', name: '编辑角色', type: 'button', sort: 2 },
    { code: 'system:role:delete', parent: 'system:role', name: '删除角色', type: 'button', sort: 3 },
    { code: 'system:menu', parent: 'system', name: '菜单管理', path: '/system/menus', icon: 'MenuBook', sort: 3 },
    { code: 'system:menu:add', parent: 'system:menu', name: '新增菜单', type: 'button', sort: 1 },
    { code: 'system:menu:edit', parent: 'system:menu', name: '编辑菜单', type: 'button', sort: 2 },
    { code: 'system:menu:delete', parent: 'system:menu', name: '删除菜单', type: 'button', sort: 3 },
    { code: 'system:dict', parent: 'system', name: '字典管理', path: '/system/dicts', icon: 'Book', sort: 4 },
    { code: 'system:dict:add', parent: 'system:dict', name: '新增字典', type: 'button', sort: 1 },
    { code: 'system:dict:edit', parent: 'system:dict', name: '编辑字典', type: 'button', sort: 2 },
    { code: 'system:dict:delete', parent: 'system:dict', name: '删除字典', type: 'button', sort: 3 },
    { code: 'demo', parent: null, name: '示例业务', path: '/demo', icon: 'Layers', sort: 3 },
    { code: 'demo:item', parent: 'demo', name: '物品管理', path: '/demo/items', icon: 'Inventory2', sort: 1 },
    { code: 'demo:item:add', parent: 'demo:item', name: '新增物品', type: 'button', sort: 1 },
    { code: 'demo:item:edit', parent: 'demo:item', name: '编辑物品', type: 'button', sort: 2 },
    { code: 'demo:item:delete', parent: 'demo:item', name: '删除物品', type: 'button', sort: 3 },
  ];
  const menuId = {};
  for (const m of menuDefs) {
    const r = await pool.query(
      `INSERT INTO menu (parent_id, code, name, path, icon, sort, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [m.parent ? menuId[m.parent] : null, m.code, m.name, m.path ?? null, m.icon ?? null, m.sort ?? 0, m.type ?? 'menu']
    );
    menuId[m.code] = r.rows[0].id;
  }

  // super_admin = 全部菜单；viewer = 仪表盘 + 示例业务（无按钮）
  for (const id of Object.values(menuId)) {
    await pool.query(`INSERT INTO role_menu (role_id, menu_id) VALUES ($1, $2)`, [roleId.super_admin, id]);
  }
  for (const code of ['dashboard', 'demo', 'demo:item']) {
    await pool.query(`INSERT INTO role_menu (role_id, menu_id) VALUES ($1, $2)`, [roleId.viewer, menuId[code]]);
  }

  // 用户：admin/admin123、demo/demo123
  const adminPw = hashPassword('admin123');
  const demoPw = hashPassword('demo123');
  const admin = await pool.query(
    `INSERT INTO user_account (username, password_hash, password_salt, nickname, email, status)
     VALUES ('admin', $1, $2, 'Administrator', 'admin@example.com', '1') RETURNING id`,
    [adminPw.hash, adminPw.salt]
  );
  const demo = await pool.query(
    `INSERT INTO user_account (username, password_hash, password_salt, nickname, email, status)
     VALUES ('demo', $1, $2, '演示用户', 'demo@example.com', '1') RETURNING id`,
    [demoPw.hash, demoPw.salt]
  );
  await pool.query(`INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)`, [admin.rows[0].id, roleId.super_admin]);
  await pool.query(`INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)`, [demo.rows[0].id, roleId.viewer]);

  // 字典
  const dictTypes = [
    {
      code: 'sys_status', name: '通用状态', description: '启用/停用',
      items: [
        { label: '启用', value: '1', color: 'success', sort: 1 },
        { label: '停用', value: '0', color: 'default', sort: 2 },
      ],
    },
    {
      code: 'sys_yes_no', name: '是/否', description: '布尔类字段',
      items: [
        { label: '是', value: '1', color: 'success', sort: 1 },
        { label: '否', value: '0', color: 'default', sort: 2 },
      ],
    },
    {
      code: 'item_category', name: '物品分类', description: '示例业务的分类字典',
      items: [
        { label: '电子产品', value: 'electronics', color: 'primary', sort: 1 },
        { label: '办公用品', value: 'office', color: 'info', sort: 2 },
        { label: '生活用品', value: 'daily', color: 'warning', sort: 3 },
      ],
    },
  ];
  for (const t of dictTypes) {
    await pool.query(`INSERT INTO dict_type (code, name, description) VALUES ($1, $2, $3)`, [t.code, t.name, t.description]);
    for (const it of t.items) {
      await pool.query(
        `INSERT INTO dict_item (type_code, label, value, color, sort) VALUES ($1, $2, $3, $4, $5)`,
        [t.code, it.label, it.value, it.color, it.sort]
      );
    }
  }

  // 示例物品
  const ic = await pool.query('SELECT COUNT(*)::int AS c FROM item');
  if (ic.rows[0].c === 0) {
    const items = [
      ['MacBook Pro 14', 'M4 Pro 芯片 24G/512G', 'electronics', '1'],
      ['A4 打印纸', '500 张/包', 'office', '1'],
      ['保温杯', '316 不锈钢 500ml', 'daily', '1'],
      ['无线鼠标', '静音办公 2.4G', 'electronics', '0'],
    ];
    for (const [name, desc, cat, st] of items) {
      await pool.query(`INSERT INTO item (name, description, category, status) VALUES ($1, $2, $3, $4)`, [name, desc, cat, st]);
    }
  }

  console.log('[db] 种子数据已写入');
}

// 初始化入口（启动时执行）
export async function initDb() {
  await createTables();
  await seed();
  // 清理过期会话
  await pool.query(`DELETE FROM user_session WHERE expires_at < NOW()`);
}

// Promise 化查询方法，便于 async/await
export function query(text, params = []) {
  return pool.query(text, params);
}

export default pool;
