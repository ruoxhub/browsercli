/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 给 Promise 加超时保护：超时后以 `message` 拒绝。
 *
 * 仓库内曾有多份同语义私有实现（CdpNetworkMonitor / WorkerLifecycle /
 * BrowserTargetInspector / script.ts）。本切片只收敛 CDP 取体所需的一份，
 * 其余调用点签名/文案不同，属行为变更，按 spec §12 不在本切片处理。
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
