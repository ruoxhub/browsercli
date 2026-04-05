#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {startDaemon} from '../daemon/client.js';
import {isDaemonRunning} from '../daemon/utils.js';

export async function startCommand(options: {
  browserUrl?: string;
  wsEndpoint?: string;
  headless?: boolean;
  executablePath?: string;
  http?: boolean;
  port?: string;
}): Promise<void> {
  // 检查 daemon 是否已经在运行
  if (isDaemonRunning()) {
    console.error('Daemon 已经在运行中');
    console.error('如需重启，请先执行：js-reverse stop');
    process.exit(1);
  }

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
