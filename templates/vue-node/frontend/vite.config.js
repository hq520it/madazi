import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 预览环境: VITE_BASE=/api/projects/{id}/preview-proxy, VITE_BE_URL=http://localhost:3001
// 本地开发: 不设环境变量，base='/', proxy /api -> localhost:3001
const BASE = process.env.VITE_BASE || '/';
const BE_URL = process.env.VITE_BE_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [vue()],
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
