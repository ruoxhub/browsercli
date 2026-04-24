/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {BrowserContext, Page} from 'patchright';

import {logger} from '../utils/logger.js';

/**
 * SessionManager 管理多个独立的会话，每个会话有自己独占的页面集合。
 *
 * 使用场景：多个 MCP server 实例连接到同一个浏览器时，
 * 通过 sessionId 隔离页面所有权，避免抢占问题。
 *
 * 页面标签机制：
 * - 新创建的页面会自动添加标签：`mcp-session-{sessionId}`
 * - 会话只能看到带有自己标签的页面
 * - 页面关闭时自动移除标签
 *
 * CDP Session 缓存：
 * - 避免重复调用 attachToTarget
 * - 提高并发操作稳定性
 *
 * Playwright 适配说明：
 * - Browser.pages() 不存在，需通过 BrowserContext.pages() 获取
 * - Browser.newPage() 在 Playwright 中不存在，需通过 BrowserContext.newPage()
 * - 因此构造函数需要 BrowserContext 而非 Browser
 */
export class SessionManager {
  private static instances = new Map<string, SessionManager>();

  private readonly sessionId: string;
  private readonly context: BrowserContext;
  private readonly ownedPageUrls = new Set<string>();
  private readonly cdpSessions = new WeakMap<Page, number>(); // Page -> sessionId 缓存

  private constructor(sessionId: string, context: BrowserContext) {
    this.sessionId = sessionId;
    this.context = context;
  }

  /**
   * 获取或创建会话管理器实例
   */
  static getInstance(
    sessionId: string,
    context: BrowserContext,
  ): SessionManager {
    if (!SessionManager.instances.has(sessionId)) {
      SessionManager.instances.set(
        sessionId,
        new SessionManager(sessionId, context),
      );
    }
    return SessionManager.instances.get(sessionId)!;
  }

  /**
   * 清理会话实例
   */
  static cleanup(sessionId: string): void {
    SessionManager.instances.delete(sessionId);
  }

  /**
   * 清理所有会话实例
   */
  static cleanupAll(): void {
    SessionManager.instances.clear();
  }

  /**
   * 为页面添加会话标签
   */
  async tagPage(page: Page): Promise<void> {
    try {
      await page.evaluate((sessionId: string) => {
        // 使用 sessionStorage 存储会话标签，页面关闭时自动清除
        sessionStorage.setItem('mcp-session-id', sessionId);

        // 同时使用 localStorage 持久化标签（跨页面刷新）
        const url = window.location.href;
        const allSessionTags = JSON.parse(
          localStorage.getItem('mcp-session-tags') || '{}',
        );
        if (!allSessionTags[url]) {
          allSessionTags[url] = new Set();
        }
        allSessionTags[url].add(sessionId);
        localStorage.setItem(
          'mcp-session-tags',
          JSON.stringify(allSessionTags),
        );
      }, this.sessionId);

      // 记录页面 URL
      const url = page.url();
      if (url && url !== 'about:blank') {
        this.ownedPageUrls.add(url);
      }

      logger.debug(
        `[SessionManager] Tagged page for session ${this.sessionId}: ${url}`,
      );
    } catch (error) {
      logger.debug(`[SessionManager] Failed to tag page:`, error);
    }
  }

  /**
   * 移除页面的会话标签
   */
  async untagPage(page: Page): Promise<void> {
    try {
      await page.evaluate((sessionId: string) => {
        const storedSessionId = sessionStorage.getItem('mcp-session-id');
        if (storedSessionId === sessionId) {
          sessionStorage.removeItem('mcp-session-id');
        }

        // 从 localStorage 中移除
        const url = window.location.href;
        const allSessionTags = JSON.parse(
          localStorage.getItem('mcp-session-tags') || '{}',
        );
        if (allSessionTags[url]) {
          allSessionTags[url].delete(sessionId);
          if (allSessionTags[url].size === 0) {
            delete allSessionTags[url];
          }
          localStorage.setItem(
            'mcp-session-tags',
            JSON.stringify(allSessionTags),
          );
        }
      }, this.sessionId);

      const url = page.url();
      this.ownedPageUrls.delete(url);

      logger.debug(
        `[SessionManager] Untagged page for session ${this.sessionId}: ${url}`,
      );
    } catch (error) {
      logger.debug(`[SessionManager] Failed to untag page:`, error);
    }
  }

  /**
   * 检查页面是否属于当前会话
   */
  async ownsPage(page: Page): Promise<boolean> {
    try {
      const sessionId = await page.evaluate(() => {
        return sessionStorage.getItem('mcp-session-id');
      });
      return sessionId === this.sessionId;
    } catch (error) {
      logger.debug(`[SessionManager] Failed to check page ownership:`, error);
      return false;
    }
  }

  /**
   * 获取当前会话拥有的所有页面
   */
  async getOwnedPages(): Promise<Page[]> {
    const allPages = this.context.pages();
    const ownedPages: Page[] = [];

    for (const page of allPages) {
      if (await this.ownsPage(page)) {
        ownedPages.push(page);
      }
    }

    return ownedPages;
  }

  /**
   * 创建带有会话标签的新页面
   */
  async newPage(): Promise<Page> {
    const page = await this.context.newPage();
    await this.tagPage(page);
    return page;
  }

  /**
   * 从存储中恢复会话标签
   * 用于浏览器重启后恢复会话与页面的关联
   */
  async restoreSessionTags(): Promise<void> {
    try {
      const allPages = this.context.pages();

      for (const page of allPages) {
        const url = page.url();

        // 检查 URL 是否在 localStorage 中有当前会话的标签
        const hasTag = await page.evaluate((sessionId: string) => {
          const allSessionTags = JSON.parse(
            localStorage.getItem('mcp-session-tags') || '{}',
          );
          return allSessionTags[window.location.href]?.includes(sessionId);
        }, this.sessionId);

        if (hasTag) {
          // 重新添加 sessionStorage 标签
          await page.evaluate((sessionId: string) => {
            sessionStorage.setItem('mcp-session-id', sessionId);
          }, this.sessionId);
          this.ownedPageUrls.add(url);
          logger.debug(`[SessionManager] Restored tag for page: ${url}`);
        }
      }
    } catch (error) {
      logger.debug(`[SessionManager] Failed to restore session tags:`, error);
    }
  }

  /**
   * 获取页面的 CDP Session ID（带缓存）
   * 避免重复调用 attachToTarget
   */
  getCdpSessionId(page: Page): number | undefined {
    return this.cdpSessions.get(page);
  }

  /**
   * 缓存页面的 CDP Session ID
   */
  setSessionPage(page: Page, sessionId: number): void {
    this.cdpSessions.set(page, sessionId);
  }

  /**
   * 清除页面的 CDP Session 缓存
   * 页面关闭时调用
   */
  clearSessionPage(page: Page): void {
    this.cdpSessions.delete(page);
  }
}
