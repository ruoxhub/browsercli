/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {BrowserManager} from '../modules/browser/index.js';
import {dbService} from '../services/DatabaseService.js';

interface ShutdownDependencies {
  browserManager: BrowserManager;
  contextProvider?: {dispose(): void | Promise<void>};
  database?: Pick<typeof dbService, 'disconnect'>;
  exit?: (code: number) => never;
  timeoutMs?: number;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 创建带本地状态的优雅关闭处理器，避免入口文件持有关闭细节。
 */
export function createGracefulShutdown({
  browserManager,
  contextProvider,
  database = dbService,
  exit = process.exit,
  timeoutMs = 10000,
}: ShutdownDependencies): (signal: string) => Promise<void> {
  let isShuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[Worker] 收到 ${signal}，开始优雅关闭...`);

    if (contextProvider) {
      try {
        await withTimeout(
          Promise.resolve(contextProvider.dispose()),
          timeoutMs,
          '释放 ContextProvider 超时',
        );
        console.log('[Worker] ContextProvider 已释放');
      } catch (err) {
        console.error('[Worker] 释放 ContextProvider 失败:', err);
      }
    }

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
