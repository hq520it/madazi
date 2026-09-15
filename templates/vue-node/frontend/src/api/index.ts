import axios from 'axios';

// ★ 统一 API 封装：全项目唯一拼接 base 前缀的地方，业务代码不感知 BASE_URL。
//   预览环境 base=/api/projects/{id}/preview-proxy（平台注入 VITE_BASE），
//   请求必须带 base 前缀才会被 Vite proxy 转发到后端；本地 dev base='/' 同样成立。
//   禁止在业务里写绝对 http://localhost 或裸 /api 路径（预览下命中不了 proxy 会 404）。
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
const API_ROOT = `${BASE}/api`

export const api = axios.create({
  baseURL: API_ROOT,
  headers: { 'Content-Type': 'application/json' }
});

// ★ url 归一化：业务写 '/items' 或 'items' 均可——剥前导斜杠转相对路径，
//   否则 axios 会把以 / 开头的 url 当作根路径覆盖 baseURL（丢 base 前缀 → 预览 404）
api.interceptors.request.use((config) => {
  if (typeof config.url === 'string') {
    config.url = config.url.replace(/^\/+/, '')
  }
  return config
});
