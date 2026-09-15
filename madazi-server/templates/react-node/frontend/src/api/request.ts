// ★ 统一请求封装：所有 API 走 import.meta.env.BASE_URL 前缀（预览环境 base 非根，禁止写死 /api 绝对路径）
// 携带 Bearer Token；401 自动清理登录态并跳转登录页
const BASE = import.meta.env.BASE_URL;

export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('admin_token');
  const res = await fetch(`${BASE}api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    if (!location.hash.startsWith('#/login')) {
      location.hash = '#/login';
    }
    throw new ApiError(401, '登录已过期，请重新登录');
  }

  let body: { code?: number; data?: T; message?: string };
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, '服务响应异常');
  }
  if (!res.ok || (body.code !== undefined && body.code !== 200 && body.code !== 201)) {
    throw new ApiError(body.code ?? res.status, body.message || '请求失败');
  }
  return body.data as T;
}

export const get = <T>(path: string) => request<T>(path);
export const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });
export const put = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(data ?? {}) });
export const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });
