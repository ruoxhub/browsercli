import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev posture: 开发者访问 5173，由 Vite 反代 /api 与 /ws 到 ConsoleServer (8765)。
// 生产模式下 ConsoleServer 直接服务 apps/web/dist 静态资源。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: false,
      },
      '/ws': {
        target: 'http://127.0.0.1:8765',
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
