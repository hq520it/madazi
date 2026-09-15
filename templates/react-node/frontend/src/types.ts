// 全局类型定义

export interface Role {
  id: string;
  code: string;
  name: string;
}

export interface UserInfo {
  id: string;
  username: string;
  nickname: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  roles?: Role[];
  permissions?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface MenuItem {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  path?: string | null;
  icon?: string | null;
  sort: number;
  type: 'menu' | 'button';
  status: string;
  children?: MenuItem[];
}

export interface DictEntry {
  label: string;
  value: string;
  color?: string | null;
  sort?: number;
}

export interface DictTypeWithItems {
  code: string;
  name: string;
  items: DictEntry[];
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

export interface Item {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface UserRow extends UserInfo {
  roles: Role[];
}

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: string;
  userCount: number;
  created_at?: string;
  updated_at?: string;
}

export interface MenuRow extends MenuItem {
  children?: MenuRow[];
}

export interface DictTypeRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: string;
  itemCount: number;
  created_at?: string;
  updated_at?: string;
}

export interface DictItemRow {
  id: string;
  type_code: string;
  label: string;
  value: string;
  color?: string | null;
  sort: number;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardStats {
  userCount: number;
  roleCount: number;
  dictCount: number;
  itemCount: number;
  recentItems: Item[];
}

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: UserInfo;
  menus: MenuItem[];
}
