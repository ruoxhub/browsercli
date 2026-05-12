/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DebuggerSessionManager — CDP 调试上下文的创建、复用和释放
 *
 * 每个 Page 绑定一个 DebuggerContext + CDPSession。
 * 复用已启用的 DebuggerContext，避免重复 attach。
 */

import type {CDPSession, Page} from 'patchright';

import {DebuggerContext} from '../../DebuggerContext.js';

export class DebuggerSessionManager {
  private _debuggerContexts = new WeakMap<Page, DebuggerContext>();
  private _debuggerSessions = new WeakMap<Page, CDPSession>();

  /**
   * 获取或创建指定页面的 DebuggerContext。
   * 已启用的会被复用；未启用或未创建的会重新 attach CDP session。
   *
   * 页面关闭时会自动清理（绑定在 page.once('close', ...)）。
   */
  async ensureForPage(page: Page): Promise<DebuggerContext> {
    const existing = this._debuggerContexts.get(page);
    if (existing?.isEnabled()) {
      return existing;
    }

    const client = await page.context().newCDPSession(page);
    const debuggerContext = new DebuggerContext();
    await debuggerContext.enable(client);

    this._debuggerContexts.set(page, debuggerContext);
    this._debuggerSessions.set(page, client);

    page.once('close', () => {
      void this.dispose(page);
    });

    return debuggerContext;
  }

  /**
   * 释放指定页面的 DebuggerContext 与 CDPSession。
   * 忽略清理过程中可能抛出的错误（页面/会话可能已经不存在）。
   */
  async dispose(page: Page): Promise<void> {
    const debuggerContext = this._debuggerContexts.get(page);
    if (debuggerContext) {
      try {
        await debuggerContext.disable();
      } catch {
        // Ignore cleanup errors when the page/session is already gone.
      }
    }

    const client = this._debuggerSessions.get(page);
    if (client) {
      try {
        await client.detach();
      } catch {
        // Ignore cleanup errors when the page/session is already gone.
      }
    }

    this._debuggerContexts.delete(page);
    this._debuggerSessions.delete(page);
  }

  /**
   * 批量释放所有已追踪页面的调试资源。
   */
  async disposeAll(pages: Page[]): Promise<void> {
    for (const page of pages) {
      await this.dispose(page);
    }
  }
}
