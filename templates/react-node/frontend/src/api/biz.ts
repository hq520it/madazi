import { get, put, post, del, qs } from './request';
import type { DashboardStats, Item, PageResult } from '../types';

// 用户页面偏好（搜索条件/表格列配置跟着用户走）
export function getPreference(pageCode: string) {
  return get<Record<string, unknown> | null>(`/preferences/${pageCode}`);
}

export function savePreference(pageCode: string, config: object) {
  return put<null>(`/preferences/${pageCode}`, { config });
}

// 仪表盘
export function dashboardStats() {
  return get<DashboardStats>('/dashboard/stats');
}

// 物品管理（示例业务）
export function listItems(params: {
  page: number;
  size: number;
  search?: string;
  category?: string;
  status?: string;
}) {
  return get<PageResult<Item>>(`/items${qs(params)}`);
}

export function createItem(data: { name: string; description?: string; category?: string; status: string }) {
  return post<Item>('/items', data);
}

export function updateItem(
  id: string,
  data: { name: string; description?: string; category?: string; status: string }
) {
  return put<Item>(`/items/${id}`, data);
}

export function deleteItem(id: string) {
  return del<null>(`/items/${id}`);
}
