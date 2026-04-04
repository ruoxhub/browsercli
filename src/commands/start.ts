#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {startDaemon} from '../daemon/client.js';

export async function startCommand(options: {
  browserUrl?: string;
  wsEndpoint?: string;
  headless?: boolean;
  executablePath?: string;
  http?: boolean;
  port?: string;
}): Promise<void> {
  const args: string[] = [];

  if (options.browserUrl) {
    args.push('--browserUrl', options.browserUrl);
  }
  if (options.wsEndpoint) {
    args.push('--wsEndpoint', options.wsEndpoint);
  }
  if (options.headless) {
    args.push('--headless');
  }
  if (options.executablePath) {
    args.push('--executablePath', options.executablePath);
  }

  console.log('启动 Daemon 服务...');
  await startDaemon(args);
  console.log('Daemon 启动成功');

  if (options.http) {
    // 懒加载：只有 --http 模式才加载 express
    const {createHttpServer} = await import('../daemon/http-server.js');
    const port = parseInt(options.port || '3000', 10);
    console.log(`启动 HTTP 服务器，端口：${port}`);
    const server = await createHttpServer({port});
    console.log(`HTTP 服务器运行在 http://localhost:${port}`);

    // 保持进程运行
    process.on('SIGINT', () => {
      server.close(() => console.log('HTTP 服务器已关闭'));
    });
  }
}
