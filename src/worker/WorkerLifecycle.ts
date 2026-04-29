/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {BrowserManager} from '../browser/index.js';
import type {RpcClient} from '../protocol/Client.js';
import {dbService} from '../services/DatabaseService.js';

interface ShutdownDependencies {
  browserManager: BrowserManager;
  client: RpcClient;
  database?: Pick<typeof dbService, 'disconnect'>;
  exit?: (code: number) => never;
  timeoutMs?: number;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return await Promise.race([
    operation,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs),
    ),
  ]);
}

/**
 * 创建带本地状态的优雅关闭处理器，避免入口文件持有关闭细节。
 */
export function createGracefulShutdown({
  browserManager,
  client,
  database = dbService,
  exit = process.exit,
  timeoutMs = 10000,
}: ShutdownDependencies): (signal: string) => Promise<void> {
  let isShuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[Worker] 收到 ${signal}，开始优雅关闭...`);
    client.disconnect();

    try {
      await withTimeout(browserManager.close(), timeoutMs, '关闭浏览器超时');
      console.log('[Worker] 浏览器已关闭');
    } catch (err) {
      console.error('[Worker] 关闭浏览器失败:', err);
    }

    try {
      await withTimeout(database.disconnect(), timeoutMs, '关闭数据库连接超时');
      console.log('[Worker] 数据库连接已关闭');
    } catch (err) {
      console.error('[Worker] 关闭数据库连接失败:', err);
    }

    console.log('[Worker] 已关闭');
    exit(0);
  };
}
