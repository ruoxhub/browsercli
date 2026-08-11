/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DebuggerContextProvider — CDP 调试上下文的创建、复用和释放
 *
 * 每个 Page 绑定一个 DebuggerContext + CDPSession。
 * 复用已启用的 DebuggerContext，避免重复 attach。
 */

import type {CDPSession, Page} from 'patchright';

import {DebuggerManager} from '../../modules/debugger/DebuggerManager.js';

export class DebuggerContextProvider {
  private _debuggerManagers = new WeakMap<Page, DebuggerManager>();
  private _debuggerSessions = new WeakMap<Page, CDPSession>();

  getForPage(page: Page): DebuggerManager | undefined {
    const manager = this._debuggerManagers.get(page);
    return manager?.isEnabled() ? manager : undefined;
  }

  /**
   * 获取或创建指定页面的 DebuggerManager。
   * 已启用的会被复用；未启用或未创建的会重新 attach CDP session。
   */
  async ensureForPage(page: Page): Promise<DebuggerManager> {
    const existing = this._debuggerManagers.get(page);
    if (existing?.isEnabled()) {
      return existing;
    }

    const client = await page.context().newCDPSession(page);
    // 走 enable(client) 外部 session 分支，DebuggerManager 仅需 getActivePage
    // 协议；无需伪造完整 CodeCollector。
    const manager = new DebuggerManager({
      getActivePage: async () => page,
    });
    await manager.enable(client);

    this._debuggerManagers.set(page, manager);
    this._debuggerSessions.set(page, client);

    page.once('close', () => {
      void this.dispose(page);
    });

    return manager;
  }

  /**
   * 释放指定页面的 DebuggerManager 与 CDPSession。
   */
  async dispose(page: Page): Promise<void> {
    const manager = this._debuggerManagers.get(page);
    if (manager) {
      try {
        await manager.disable();
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

    this._debuggerManagers.delete(page);
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
