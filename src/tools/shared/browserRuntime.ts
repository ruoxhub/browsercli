/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';
import {zod} from '../../third_party/index.js';

const DEFAULT_OPERATION_TIMEOUT_MS = 5000;

/**
 * 页面操作超时的 zod schema 片段。
 * click / fill / fill_form / take_screenshot / evaluate_script 共用，仅描述文案不同。
 */
export function browserTimeoutSchema(description: string) {
  return zod
    .number()
    .int()
    .min(1)
    .max(300_000)
    .optional()
    .describe(description);
}

interface DebuggerTrapManager {
  getPausedState(): {reason: string} | null;
  getClient(): {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  } | null;
  resume(): Promise<void>;
}

interface DebuggerTrapContext {
  getExistingDebuggerContext?(): unknown;
}

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

export async function withDebuggerTrapBypass<T>(
  context: DebuggerTrapContext,
  action: () => Promise<T>,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<T> {
  const manager = context.getExistingDebuggerContext?.() as
    | DebuggerTrapManager
    | undefined;
  if (manager?.getPausedState()?.reason !== 'debugCommand') {
    return await action();
  }

  const client = manager.getClient();
  if (!client) {
    return await action();
  }

  await withOperationTimeout(
    client.send('Debugger.setSkipAllPauses', {skip: true}),
    '启用调试器陷阱绕过',
    timeoutMs,
  );
  try {
    await withOperationTimeout(manager.resume(), '恢复页面执行', timeoutMs);
    return await action();
  } finally {
    await withOperationTimeout(
      client.send('Debugger.setSkipAllPauses', {skip: false}),
      '还原调试器暂停',
      timeoutMs,
    ).catch(() => undefined);
  }
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
