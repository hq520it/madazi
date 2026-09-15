// ★ 统一 API 封装：全项目唯一拼接 base 前缀的地方，业务代码不感知 BASE_URL。
//   预览环境 base=/api/projects/{id}/preview-proxy（平台注入 VITE_BASE），
//   请求必须带 base 前缀才会被 Vite proxy 转发到后端；本地 dev base='/' 同样成立。
//   禁止在业务里写 fetch('/api/...') 绝对路径（预览下命中不了 proxy 会 404）。
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
const API_ROOT = `${BASE}/api`

/** 归一化路径：剥前导斜杠，防拼接双斜杠。传 '/items' 或 'items' 均可 */
export function apiUrl(path: string): string {
  return `${API_ROOT}/${String(path).replace(/^\/+/, '')}`
}

/** 统一请求入口：base 前缀 + 相对资源路径 */
export async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error((j && (j as any).error) || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}