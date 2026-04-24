/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';

const DEFAULT_OPERATION_TIMEOUT_MS = 5000;

export async function withOperationTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} 超时 (${timeoutMs}ms)`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function normalizeBrowserRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed/i.test(message)) {
    return `浏览器连接失败，页面或 CDP 会话可能已失效: ${message}`;
  }
  if (/Target page, context or browser has been closed/i.test(message)) {
    return `当前页面、上下文或浏览器已关闭: ${message}`;
  }
  if (/Execution context was destroyed/i.test(message)) {
    return `页面刚发生导航，执行上下文已销毁: ${message}`;
  }
  return message;
}

export async function getActivePageWithGuard(
  runtime: {getActivePage: () => Promise<Page>},
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<Page> {
  const page = await withOperationTimeout(
    runtime.getActivePage(),
    '获取当前页面',
    timeoutMs,
  );
  if (page.isClosed()) {
    throw new Error('当前页面已关闭');
  }
  return page;
}
