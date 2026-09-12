/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Page} from 'patchright';

/**
 * 在瞬态场景下安全执行基于 CDP Session 的操作，并在完成或抛出异常后确保 Session detach。
 * 吞掉 target/session closed 类预期错误，防止页面已销毁时的二次报错。
 */
export async function withCdpSession<T>(
  page: Page,
  fn: (client: CDPSession) => Promise<T>,
): Promise<T> {
  const client = await page.context().newCDPSession(page);
  try {
    return await fn(client);
  } finally {
    try {
      await client.detach();
    } catch {
      // 忽略 Target closed / Session closed / Page closed 等预期清理错误
    }
  }
}
