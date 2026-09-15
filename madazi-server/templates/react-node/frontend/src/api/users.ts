import { get, post, put, del, qs } from './request';
import type { PageResult, Role, RoleRow, UserRow } from '../types';

// 用户管理 API

export function listUsers(params: { page: number; size: number; search?: string; status?: string }) {
  return get<PageResult<UserRow>>(`/users${qs(params)}`);
}

export function createUser(data: {
  username: string;
  password: string;
  nickname?: string;
  email?: string;
  phone?: string;
  status: string;
  roleIds: string[];
}) {
  return post<UserRow>('/users', data);
}

export function updateUser(
  id: string,
  data: { nickname?: string; email?: string; phone?: string; status: string; roleIds?: string[] }
) {
  return put<UserRow>(`/users/${id}`, data);
}

export function resetPassword(id: string, password: string) {
  return put<null>(`/users/${id}/password`, { password });
}

export function deleteUser(id: string) {
  return del<null>(`/users/${id}`);
}

// 全部角色（用户编辑弹窗下拉用）
export function allRoles() {
  return get<Role[]>('/roles/all');
}
