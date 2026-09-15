import { get, post } from './request';
import type { LoginParams, LoginResult, MenuItem, UserInfo } from '../types';

// 登录（公开）
export function login(params: LoginParams) {
  return post<LoginResult>('/auth/login', params);
}

// 当前用户信息（含权限 + 菜单树）
export function me() {
  return get<{ user: UserInfo; menus: MenuItem[] }>('/auth/me');
}

// 登出（销毁会话）
export function logout() {
  return post<null>('/auth/logout');
}
