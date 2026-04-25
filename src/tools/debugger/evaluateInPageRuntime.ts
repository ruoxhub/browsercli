/**
 * @license
 * Copyright 2026 Google LLC
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

function hasPage(frame: Frame): frame is Frame & {page(): Page} {
  return typeof (frame as Frame & {page?: () => Page}).page === 'function';
}

export async function evaluateInPageRuntime<T>(
  frame: Frame,
  expression: string,
): Promise<T> {
  if (!hasPage(frame)) {
    return (await frame.evaluate(expression)) as T;
  }

  const page = frame.page();
  const client: CDPSession = await page.context().newCDPSession(page);

  try {
    const runtimeResult = (await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as RuntimeEvaluateResult<T>;

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
