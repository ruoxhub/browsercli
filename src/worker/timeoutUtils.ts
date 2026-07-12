/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from 'patchright';

export const FRAME_EVALUATE_TIMEOUT = 10_000;

export function wrapFrameWithTimeout(
  frame: Frame,
  timeoutMs: number = FRAME_EVALUATE_TIMEOUT,
): Frame {
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
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `frame.evaluate() 超时 (${timeoutMs}ms)，可能调试器已暂停`,
                  ),
                ),
              timeoutMs,
            );
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
