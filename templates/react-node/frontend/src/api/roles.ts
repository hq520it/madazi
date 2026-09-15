import { get, post, put, del, qs } from './request';
import type { MenuRow, PageResult, RoleRow } from '../types';

// 角色管理 API

export function listRoles(params: { page: number; size: number; search?: string }) {
  return get<PageResult<RoleRow>>(`/roles${qs(params)}`);
}

export function roleDetail(id: string) {
  return get<RoleRow & { menuIds: string[] }>(`/roles/${id}`);
}

// 角色授权用的完整菜单（扁平）
export function menuTreeAll() {
  return get<MenuRow[]>('/roles/menu-tree/all');
}

export function createRole(data: {
  code: string;
  name: string;
  description?: string;
  status: string;
  menuIds: string[];
}) {
  return post<RoleRow>('/roles', data);
}

export function updateRole(
  id: string,
  data: { code: string; name: string; description?: string; status: string; menuIds?: string[] }
) {
  return put<RoleRow>(`/roles/${id}`, data);
}

export function deleteRole(id: string) {
  return del<null>(`/roles/${id}`);
}
