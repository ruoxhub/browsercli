/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from 'patchright';

export const FRAME_EVALUATE_TIMEOUT = 10_000;

export interface FrameTimeoutOptions {
  timeoutMs?: number;
  autoTerminate?: boolean;
  onTimeout?: (frame: Frame) => void | Promise<void>;
}

export async function terminateFrameExecution(frame: Frame): Promise<void> {
  try {
    const page = typeof frame.page === 'function' ? frame.page() : null;
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
      return;
    }
    const context = typeof page.context === 'function' ? page.context() : null;
    if (!context || typeof context.newCDPSession !== 'function') {
      return;
    }
    const session = await context.newCDPSession(page);
    try {
      await Promise.allSettled([
        session.send('Runtime.terminateExecution'),
        session.send('Page.stopLoading'),
      ]);
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {
    return;
  }
}

export function wrapFrameWithTimeout(
  frame: Frame,
  optionsOrTimeout: number | FrameTimeoutOptions = FRAME_EVALUATE_TIMEOUT,
): Frame {
  const options: FrameTimeoutOptions =
    typeof optionsOrTimeout === 'number'
      ? {timeoutMs: optionsOrTimeout}
      : optionsOrTimeout;
  const timeoutMs = options.timeoutMs ?? FRAME_EVALUATE_TIMEOUT;
  const autoTerminate = options.autoTerminate ?? true;

  return new Proxy(frame, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'evaluate') {
        return function evaluateWithTimeout(this: unknown, ...args: unknown[]) {
          const evalPromise = (value as (...args: unknown[]) => unknown).apply(
            target,
            args,
          );
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              if (autoTerminate) {
                void terminateFrameExecution(target);
              }
              if (options.onTimeout) {
                void Promise.resolve(options.onTimeout(target)).catch(() => {});
              }
              reject(
                new Error(
                  `frame.evaluate() 超时 (${timeoutMs}ms)，可能调试器已暂停或处于死循环`,
                ),
              );
            }, timeoutMs);
          });
          return Promise.race([evalPromise, timeoutPromise]).finally(() => {
            if (timer) clearTimeout(timer);
          });
        };
      }
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}
