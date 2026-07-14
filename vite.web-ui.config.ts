/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dev posture: 开发者访问 5173，由 Vite 反代 /api 与 /ws 到 ConsoleServer (8765)。
// 生产模式下 ConsoleServer 直接服务 build/web 静态资源（前端源码已迁入 src/web-ui）。
export default defineConfig({
  root: resolve(__dirname, 'src/web-ui'),
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
    outDir: resolve(__dirname, 'build/web'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
