/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * @ts-nocheck
 */

import type {CDPSession, Page} from './third_party/index.js';

/**
 * CDP Session cache layer for Puppeteer.
 *
 * In Puppeteer, `page._client()` is synchronous and returns the same session.
 * This provider provides a typed wrapper with session caching.
 */
export class CdpSessionProvider {
  #pageSessions = new WeakMap<Page, CDPSession>();

  /**
   * Get a cached CDP session for a page, creating one if needed.
   */
  async getSession(page: Page): Promise<CDPSession> {
    const cached = this.#pageSessions.get(page);
    if (cached) {
      return cached;
    }
    const session = (await page.createCDPSession()) as CDPSession;
    this.#pageSessions.set(page, session);
    return session;
  }

  /**
   * Invalidate cached session for a page.
   * Call this when the page is closed or navigated.
   */
  invalidate(page: Page): void {
    const session = this.#pageSessions.get(page);
    if (session) {
      void session.detach().catch(() => {});
      this.#pageSessions.delete(page);
    }
  }
}
