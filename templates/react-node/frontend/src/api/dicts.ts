import { get, post, put, del, qs } from './request';
import type { DictItemRow, DictTypeRow, DictTypeWithItems, MenuRow, PageResult } from '../types';

// 菜单管理 API
export function menuTree() {
  return get<MenuRow[]>('/menus');
}

export function createMenu(data: {
  parent_id?: string | null;
  code: string;
  name: string;
  path?: string | null;
  icon?: string | null;
  sort?: number;
  type: 'menu' | 'button';
  status: string;
}) {
  return post<MenuRow>('/menus', data);
}

export function updateMenu(
  id: string,
  data: {
    parent_id?: string | null;
    code: string;
    name: string;
    path?: string | null;
    icon?: string | null;
    sort?: number;
    type: 'menu' | 'button';
    status: string;
  }
) {
  return put<MenuRow>(`/menus/${id}`, data);
}

export function deleteMenu(id: string) {
  return del<null>(`/menus/${id}`);
}

// ============ 字典 API ============

// 全量字典（登录即可，下拉/标签缓存）
export function allDicts() {
  return get<DictTypeWithItems[]>('/dicts/all');
}

export function listDictTypes(params: { page: number; size: number; search?: string }) {
  return get<PageResult<DictTypeRow>>(`/dicts/types${qs(params)}`);
}

export function createDictType(data: { code: string; name: string; description?: string; status: string }) {
  return post<DictTypeRow>('/dicts/types', data);
}

export function updateDictType(id: string, data: { code: string; name: string; description?: string; status: string }) {
  return put<DictTypeRow>(`/dicts/types/${id}`, data);
}

export function deleteDictType(id: string) {
  return del<null>(`/dicts/types/${id}`);
}

export function listDictItems(typeCode: string) {
  return get<DictItemRow[]>(`/dicts/items${qs({ typeCode })}`);
}

export function createDictItem(data: {
  type_code: string;
  label: string;
  value: string;
  color?: string;
  sort?: number;
  status: string;
}) {
  return post<DictItemRow>('/dicts/items', data);
}

export function updateDictItem(
  id: string,
  data: { type_code: string; label: string; value: string; color?: string; sort?: number; status: string }
) {
  return put<DictItemRow>(`/dicts/items/${id}`, data);
}

export function deleteDictItem(id: string) {
  return del<null>(`/dicts/items/${id}`);
}
