/**
 * @license
 * Copyright 2026 Browser-CLI
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

interface RuntimeExecutionContextCreatedEvent {
  context: {
    id: number;
    auxData?: {isDefault?: boolean; type?: string};
  };
}

const EVALUATE_TIMEOUT = 10_000;

/**
 * 在页面默认 world 中执行表达式。只启用 Runtime 域，不启用 Debugger 域，
 * 避免页面中的 debugger 语句暂停执行。
 */
export async function evaluateInPageRuntime<T>(
  frame: Frame,
  expression: string,
  timeoutMs: number = EVALUATE_TIMEOUT,
): Promise<T> {
  const frameWithPage = frame as Frame & {page?: () => Page};
  if (typeof frameWithPage.page !== 'function') {
    return (await frame.evaluate(expression)) as T;
  }

  const page = frameWithPage.page();
  const client: CDPSession = await page.context().newCDPSession(page);
  const executionContexts: Array<
    RuntimeExecutionContextCreatedEvent['context']
  > = [];
  const handleExecutionContextCreated = (
    event: RuntimeExecutionContextCreatedEvent,
  ) => executionContexts.push(event.context);
  client.on('Runtime.executionContextCreated', handleExecutionContextCreated);
  let evaluateTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await client.send('Runtime.enable');
    const defaultContext = executionContexts.find(
      context =>
        context.auxData?.isDefault === true &&
        context.auxData.type !== 'isolated',
    );
    const evaluateParams: {
      expression: string;
      returnByValue: boolean;
      awaitPromise: boolean;
      contextId?: number;
    } = {
      expression,
      returnByValue: true,
      awaitPromise: true,
    };
    if (defaultContext) {
      evaluateParams.contextId = defaultContext.id;
    }
    const evaluatePromise = client.send(
      'Runtime.evaluate',
      evaluateParams,
    ) as Promise<RuntimeEvaluateResult<T>>;

    const runtimeResult = await Promise.race([
      evaluatePromise,
      new Promise<never>((_, reject) => {
        evaluateTimeout = setTimeout(
          () =>
            reject(
              new Error(
                `Runtime.evaluate 超时 (${timeoutMs}ms)，可能调试器已暂停`,
              ),
            ),
          timeoutMs,
        );
      }),
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
    if (evaluateTimeout) clearTimeout(evaluateTimeout);
    client.off(
      'Runtime.executionContextCreated',
      handleExecutionContextCreated,
    );
    await client.send('Runtime.disable').catch(() => undefined);
    await client.detach().catch(() => undefined);
  }
}
