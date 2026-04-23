/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolContextProvider — 从运行时环境提供 Tool 执行所需的上下文
 *
 * 实现各工具模块的 XxxRuntimeServices 接口，
 * 作为 ToolAdapter 与纯函数工具之间的桥梁。
 */

import type {Browser, BrowserContext, Page} from 'playwright-core';

export class ToolContextProvider {
  private selectedPage: Page | null = null;
  private pagesList: Page[] = [];
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;

  constructor() {}

  // ─── Browser / Context 管理 ──────────────────────────

  setBrowser(browser: Browser): void {
    this._browser = browser;
  }

  getBrowser(): Browser | null {
    return this._browser;
  }

  setContext(context: BrowserContext): void {
    this._context = context;
  }

  getContext(): BrowserContext | null {
    return this._context;
  }

  // ─── NavigationRuntimeServices ──────────────────────

  getSelectedPage(): Page | null {
    return this.selectedPage;
  }

  setSelectedPage(page: Page | null): void {
    this.selectedPage = page;
  }

  getPages(): Page[] {
    // 优先从 context 获取最新页面列表
    if (this._context) {
      this.pagesList = this._context.pages();
    }
    return this.pagesList;
  }

  setPages(pages: Page[]): void {
    this.pagesList = pages;
  }

  getPageByIdx(idx: number): Page {
    const pages = this.getPages();
    const page = pages[idx];
    if (!page) throw new Error(`页面索引 ${idx} 超出范围 (共 ${pages.length} 个页面)`);
    return page;
  }

  async newPage(): Promise<Page> {
    if (!this._context) throw new Error('BrowserContext 未初始化');
    const page = await this._context.newPage();
    this.pagesList = this._context.pages();
    return page;
  }

  selectPage(page: Page): void {
    this.selectedPage = page;
  }

  async bringPageToFront(page: Page): Promise<void> {
    await page.bringToFront();
  }

  syncPageContext(page: Page): void {
    this.selectedPage = page;
  }

  // ─── PageRuntimeServices / ScreenshotRuntimeServices ──

  async getActivePage(): Promise<Page> {
    if (this.selectedPage && !this.selectedPage.isClosed()) {
      return this.selectedPage;
    }
    // 尝试获取第一个可用页面
    const pages = this.getPages();
    const activePage = pages.find(p => !p.isClosed()) ?? null;
    if (activePage) {
      this.selectedPage = activePage;
      return activePage;
    }
    throw new Error('没有可用的页面');
  }

  isBrowserConnected(): boolean {
    return this._browser?.isConnected() ?? false;
  }

  async isCollectorRunning(): Promise<boolean> {
    // TODO: 集成 Collector 状态
    return false;
  }

  // ─── NetworkRuntimeServices (stub) ────────────────────

  getNetworkRequests(_includePreservedRequests?: boolean): unknown[] {
    // TODO: 集成网络请求收集器
    return [];
  }

  getNetworkRequestById(_reqid: number): unknown {
    throw new Error('网络请求收集器未集成');
  }

  getNetworkRequestStableId(_request: unknown): number {
    return -1;
  }

  getRequestInitiator(_request: unknown): undefined {
    return undefined;
  }

  async getDevToolsData(): Promise<undefined> {
    return undefined;
  }

  resolveCdpRequestId(_cdpRequestId: string): undefined {
    return undefined;
  }

  // ─── ConsoleRuntimeServices (stub) ────────────────────

  getConsoleData(_includePreservedMessages?: boolean): unknown[] {
    return [];
  }

  getConsoleMessageById(_id: number): unknown {
    throw new Error('Console 收集器未集成');
  }

  getConsoleMessageStableId(_message: unknown): number {
    return -1;
  }
}
