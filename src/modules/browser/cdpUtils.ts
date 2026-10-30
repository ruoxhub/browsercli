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
  let client: CDPSession | undefined;
  try {
    client = await page.context().newCDPSession(page);
    return await fn(client);
  } finally {
    if (client) {
      try {
        await client.detach();
      } catch {
        // 忽略 Target closed / Session closed / Page closed 等预期清理错误
      }
    }
  }
}

/**
 * 每页面一个长期存活的 CDP 会话，供需要**跨调用保持**的协议状态使用。
 *
 * `withCdpSession` 用完即 detach，因此只适合瞬态操作。像
 * `Network.setUserAgentOverride` 这类覆写是会话级状态：会话 detach 后
 * 覆写立即失效（实测 navigator.userAgent 马上回到原值）。调用方需要自己
 * 持有会话 —— 本函数按 Page 缓存，重复调用复用同一个会话。
 *
 * 会话在页面关闭时自动失效，WeakMap 随之回收，无需显式清理。
 */
const persistentSessions = new WeakMap<Page, CDPSession>();

export async function getPersistentCdpSession(page: Page): Promise<CDPSession> {
  const existing = persistentSessions.get(page);
  if (existing) {
    try {
      // 探活：会话所属 target 已销毁时 send 会抛错。
      await existing.send('Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
      } as never);
      return existing;
    } catch {
      persistentSessions.delete(page);
    }
  }

  const client = await page.context().newCDPSession(page);
  persistentSessions.set(page, client);
  return client;
}
