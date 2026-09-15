import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 预览环境: VITE_BASE=/api/projects/{id}/preview-proxy, VITE_BE_URL=http://localhost:3001
// 本地开发: 不设环境变量，base='/', proxy /api -> localhost:3001
const BASE = process.env.VITE_BASE || '/';
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  base: BASE === '/' ? '/' : BASE + '/',
  server: {
    // 预览容器热更新走 wss（由平台 VITE_HMR_HOST 注入）；本地 dev 不设则无 hmr 冲突
    hmr: process.env.VITE_HMR_HOST ? { protocol: 'wss', host: process.env.VITE_HMR_HOST, clientPort: 443 } : undefined,
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    strictPort: true,
    proxy: {
      // 预览环境: /api/projects/{id}/preview-proxy/api/* -> 后端
      // 本地环境: /api/* -> 后端
      [BASE === '/' ? '/api' : BASE + '/api']: {
        target: BE_URL,
        changeOrigin: true,
        rewrite: BASE === '/' ? undefined : (p) => p.replace(BASE, ''),
      },
    },
  },
});
