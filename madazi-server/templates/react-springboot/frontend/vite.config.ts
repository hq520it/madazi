import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 预览环境: VITE_BASE=/api/projects/{id}/preview-proxy, VITE_BE_URL=http://localhost:8080
// 本地开发: 不设环境变量，base='/', proxy /api -> localhost:8080
const BASE = process.env.VITE_BASE || '/';
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  base: BASE === '/' ? '/' : BASE + '/',
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    strictPort: true,
    proxy: {
      [BASE === '/' ? '/api' : BASE + '/api']: {
        target: BE_URL,
        changeOrigin: true,
        rewrite: BASE === '/' ? undefined : (p) => p.replace(BASE, ''),
      },
    },
  },
});
