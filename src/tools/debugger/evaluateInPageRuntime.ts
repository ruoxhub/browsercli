/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Frame, Page} from '../../third_party/index.js';

interface RuntimeEvaluateResult<T> {
  exceptionDetails?: {
    text?: string;
    exception?: {description?: string; value?: unknown};
  };
  result: {
    value?: T;
    description?: string;
  };
}

/**
 * 默认超时时间（毫秒）。
 * 当调试器暂停时，Runtime.evaluate 会无限等待，因此必须手动超时。
 */
const EVALUATE_TIMEOUT = 10_000;

/**
 * 在页面 Runtime 上下文中执行表达式。
 *
 * 优先使用 CDP Runtime.evaluate（比 frame.evaluate 更可靠），
 * 并添加超时保护防止调试器暂停时无限挂起。
 */
export async function evaluateInPageRuntime<T>(
  frame: Frame,
  expression: string,
  timeoutMs: number = EVALUATE_TIMEOUT,
): Promise<T> {
  const frameWithPage = frame as Frame & {page?: () => Page};
  if (typeof frameWithPage.page !== 'function') {
    // 无 CDP 可用，回退到 frame.evaluate（已有 Proxy 超时保护）
    return (await frame.evaluate(expression)) as T;
  }

  const page = frameWithPage.page();
  const client: CDPSession = await page.context().newCDPSession(page);

  try {
    const evaluatePromise = client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as Promise<RuntimeEvaluateResult<T>>;

    const runtimeResult = await Promise.race([
      evaluatePromise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Runtime.evaluate 超时 (${timeoutMs}ms)，可能调试器已暂停`)),
          timeoutMs,
        ),
      ),
    ]);

    if (runtimeResult.exceptionDetails) {
      const description =
        runtimeResult.exceptionDetails.exception?.description ||
        runtimeResult.exceptionDetails.text ||
        'Runtime.evaluate failed';
      throw new Error(description);
    }

    return runtimeResult.result.value as T;
  } finally {
    await client.detach().catch(() => undefined);
  }
}
