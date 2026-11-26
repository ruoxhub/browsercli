/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BrowserContextProvider — 浏览器及页面级状态管理
 *
 * 职责：
 * - 维护 Browser / BrowserContext / Page 列表 / 选中 Page / 选中 Frame
 * - Dialog 监听器生命周期
 * - 超时、网络/CPU 节流与选中页联动
 */

import type {Browser, BrowserContext, Dialog, Frame, Page} from 'patchright';

import {
  applyPageEmulation,
  type EmulateOptions,
} from '../../modules/browser/EmulationManager.js';
import type {BrowserManager} from '../../modules/browser/index.js';
import {
  normalizePageId,
  type PageSelector,
  type ResolvedPage,
} from '../../modules/browser/PageIdentity.js';
import {
  WaitForHelper,
  type WaitForEventsOptions,
  type WaitForEventsResult,
} from '../../modules/browser/WaitForHelper.js';
import {LogpointManager} from '../../modules/debugger/LogpointManager.js';
import {NetworkMockManager} from '../../modules/network/NetworkMockManager.js';
import type {NewPageOptions} from '../../tools/ToolDefinition.js';

const DEFAULT_TIMEOUT = 5_000;
const NAVIGATION_TIMEOUT = 10_000;

function getNetworkMultiplierFromString(condition: string | null): number {
  switch (condition) {
    case 'Fast 4G':
      return 1;
    case 'Slow 4G':
      return 2.5;
    case 'Fast 3G':
      return 5;
    case 'Slow 3G':
      return 10;
    default:
      return 1;
  }
}

export class BrowserContextProvider {
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _browserManager: BrowserManager | null = null;

  private selectedPage: Page | null = null;
  private selectedFrame: Frame | null = null;
  private pagesList: Page[] = [];
  private pageIds = new WeakMap<Page, string>();
  private readonly pagesById = new Map<string, Page>();
  private nextPageId = 1;

  private _dialog?: Dialog;
  private _networkConditionsMap = new WeakMap<Page, string>();
  private _cpuThrottlingRateMap = new WeakMap<Page, number>();
  private readonly _networkMockManagers = new WeakMap<
    Page,
    NetworkMockManager
  >();
  private readonly _logpointManagers = new WeakMap<Page, LogpointManager>();
  private readonly _isolatedContexts = new Map<string, BrowserContext>();

  /**
   * context 被替换（重连/重启后拿到新 BrowserContext）时回调。
   * ToolContextProvider 用它把收集器重新挂到新 context，否则重连后
   * 网络/Console/WS 收集仍停留在已关闭的旧 context 上。
   */
  public onContextReplaced?: (context: BrowserContext) => void;

  // ─── Browser / Context ───────────────────────────────

  setBrowser(browser: Browser | null): void {
    // 同一实例重复传入（重连 + ensureConnectedBrowser 两条路径）时跳过，
    // 否则每次都会在同一个 browser 上叠加 disconnected 监听器。
    if (this._browser === browser) return;
    this._browser = browser;
    if (browser) {
      browser.once('disconnected', () => {
        if (this._browser === browser) {
          this._browser = null;
          this.clearContext();
        }
      });
    }
  }

  getBrowser(): Browser | null {
    if (this._browser && this._browser.isConnected()) {
      return this._browser;
    }
    const mgrBrowser = this._browserManager?.getBrowser();
    if (mgrBrowser && mgrBrowser.isConnected()) {
      this._browser = mgrBrowser;
      this._context =
        this._browserManager?.getContext() ?? mgrBrowser.contexts()[0] ?? null;
      return mgrBrowser;
    }
    return null;
  }

  setBrowserManager(browserManager: BrowserManager): void {
    this._browserManager = browserManager;
    browserManager.onDisconnected = () => {
      this._browser = null;
      this.clearContext();
    };
    browserManager.onReconnected = (browser, context) => {
      this.setBrowser(browser);
      if (context) {
        this.setContext(context);
      } else {
        const ctx = browser.contexts()[0];
        if (ctx) this.setContext(ctx);
      }
      void this.syncPages().catch(() => undefined);
    };
  }

  getBrowserManager(): BrowserManager | null {
    return this._browserManager;
  }

  setContext(context: BrowserContext): void {
    if (this._context !== context) {
      this.resetPageIdentityState();
      this._context = context;
      this.onContextReplaced?.(context);
      return;
    }
    this._context = context;
  }

  clearContext(): void {
    this._context = null;
    this.resetPageIdentityState();
  }

  getContext(): BrowserContext | null {
    if (this._context && this._browser?.isConnected()) {
      return this._context;
    }
    const browser = this.getBrowser();
    if (browser && browser.isConnected()) {
      this._context =
        this._browserManager?.getContext() ?? browser.contexts()[0] ?? null;
      return this._context;
    }
    return null;
  }

  isBrowserConnected(): boolean {
    return (
      (this._browser?.isConnected() ?? false) ||
      (this._browserManager?.isConnected() ?? false)
    );
  }

  async ensureConnectedBrowser(): Promise<Browser | null> {
    if (this.isBrowserConnected()) {
      return this.getBrowser();
    }
    if (this._browserManager) {
      try {
        const browser = await this._browserManager.ensureBrowser();
        if (browser && browser.isConnected()) {
          this.setBrowser(browser);
          const context =
            this._browserManager.getContext() ?? browser.contexts()[0] ?? null;
          if (context) {
            this.setContext(context);
          }
          await this.syncPages();
          return browser;
        }
      } catch {
        // 连接失败保持未连接状态
      }
    }
    return null;
  }

  // ─── Pages ──────────────────────────────────────────

  getPages(): Page[] {
    if (this._context) {
      const seen = new Set<Page>();
      const collected: Page[] = [];
      for (const page of this._context.pages()) {
        if (!seen.has(page)) {
          seen.add(page);
          collected.push(page);
        }
      }
      for (const isoCtx of this._isolatedContexts.values()) {
        for (const page of isoCtx.pages()) {
          if (!seen.has(page)) {
            seen.add(page);
            collected.push(page);
          }
        }
      }
      return this.reconcilePages(collected);
    }
    return this.reconcilePages(this.pagesList);
  }

  setPages(pages: Page[]): void {
    this.reconcilePages(pages);
  }

  getPageId(page: Page): string {
    const pages = this.getPages();
    if (!pages.includes(page)) {
      throw new Error('页面不属于当前 BrowserContext，请重新调用 list_pages');
    }
    return this.ensurePageId(page);
  }

  resolvePage(selector: PageSelector): ResolvedPage {
    const pages = this.getPages();
    let pageById: Page | undefined;
    let pageByIdx: Page | undefined;

    if (selector.pageId !== undefined) {
      const normalizedId = normalizePageId(selector.pageId);
      pageById = this.pagesById.get(normalizedId);
      if (!pageById) {
        const state = this.wasIssuedPageId(normalizedId) ? '已失效' : '未知';
        throw new Error(
          `${state}页面 ID ${selector.pageId}，请重新调用 list_pages`,
        );
      }
    }

    if (selector.pageIdx !== undefined) {
      if (!Number.isInteger(selector.pageIdx) || selector.pageIdx < 0) {
        throw new Error(`页面索引 ${selector.pageIdx} 必须是非负整数`);
      }
      pageByIdx = pages[selector.pageIdx];
      if (!pageByIdx) {
        throw new Error(
          `页面索引 ${selector.pageIdx} 超出范围（共 ${pages.length} 个页面）`,
        );
      }
    }

    if (pageById && pageByIdx && pageById !== pageByIdx) {
      throw new Error(
        `pageId ${selector.pageId} 与 pageIdx ${selector.pageIdx} 指向不同页面`,
      );
    }

    let page = pageById ?? pageByIdx;
    if (!page) {
      if (!selector.fallbackToSelected) {
        throw new Error('未提供 pageId 或 pageIdx');
      }
      page = this.selectedPage ?? undefined;
      if (!page) {
        throw new Error('当前没有选中的页面，请先调用 new_page 或 select_page');
      }
    }

    const pageIdx = pages.indexOf(page);
    if (pageIdx < 0) {
      throw new Error('当前没有选中的页面，请先调用 new_page 或 select_page');
    }
    return {page, pageId: this.ensurePageId(page), pageIdx};
  }

  getPageByIdx(idx: number): Page {
    return this.resolvePage({pageIdx: idx}).page;
  }

  async newPage(options?: NewPageOptions): Promise<Page> {
    if (!this._context) throw new Error('BrowserContext 未初始化');

    let targetContext = this._context;
    if (options?.isolatedContext) {
      let isoCtx = this._isolatedContexts.get(options.isolatedContext);
      if (!isoCtx) {
        const browser = this.getBrowser();
        if (!browser || typeof browser.newContext !== 'function') {
          throw new Error(
            '当前浏览器实例不支持创建隔离上下文 (isolatedContext)',
          );
        }
        isoCtx = await browser.newContext();
        this._isolatedContexts.set(options.isolatedContext, isoCtx);
      }
      targetContext = isoCtx;
    }

    const page = await targetContext.newPage();
    this.getPages();
    if (!options?.background) {
      this.selectPage(page);
    } else if (!this.selectedPage) {
      this.selectPage(page);
    }
    return page;
  }

  async closePage(pageIdxOrSelector: number | PageSelector): Promise<void> {
    const pages = this.getPages();
    if (pages.length <= 1) {
      throw new Error(
        'The last open page cannot be closed. It is fine to keep it open.',
      );
    }
    const resolved =
      typeof pageIdxOrSelector === 'number'
        ? this.resolvePage({pageIdx: pageIdxOrSelector})
        : this.resolvePage(pageIdxOrSelector);
    const mockMgr = this._networkMockManagers.get(resolved.page);
    if (mockMgr) {
      await mockMgr.dispose().catch(() => undefined);
      this._networkMockManagers.delete(resolved.page);
    }
    this._logpointManagers.get(resolved.page)?.clear();
    this._logpointManagers.delete(resolved.page);

    if (this.selectedPage === resolved.page) {
      this.clearDialog();
    }
    await resolved.page.close();
    await this.syncPages();
  }

  getNetworkMockManager(page: Page): NetworkMockManager {
    let mgr = this._networkMockManagers.get(page);
    if (!mgr) {
      mgr = new NetworkMockManager(page);
      this._networkMockManagers.set(page, mgr);
    }
    return mgr;
  }

  getLogpointManager(page: Page): LogpointManager {
    let mgr = this._logpointManagers.get(page);
    if (!mgr) {
      mgr = new LogpointManager();
      this._logpointManagers.set(page, mgr);
    }
    return mgr;
  }

  async emulate(page: Page, options: EmulateOptions): Promise<void> {
    await applyPageEmulation(page, options, {
      setNetworkConditions: c => this.setNetworkConditions(c),
      setCpuThrottlingRate: r => this.setCpuThrottlingRate(r),
    });
  }

  async waitForEventsAfterAction(
    page: Page,
    action: (signal: AbortSignal) => Promise<unknown>,
    options?: WaitForEventsOptions,
  ): Promise<WaitForEventsResult> {
    const cpuMultiplier = this.getCpuThrottlingRate();
    const networkMultiplier = getNetworkMultiplierFromString(
      this.getNetworkConditions(),
    );
    const helper = new WaitForHelper(page, cpuMultiplier, networkMultiplier);
    return await helper.waitForEventsAfterAction(action, options);
  }

  async waitForTextOnPage(
    page: Page,
    params: {text: string | string[]; timeout?: number; visible?: boolean},
  ): Promise<void> {
    const texts = Array.isArray(params.text) ? params.text : [params.text];
    if (texts.length === 0) {
      throw new Error('At least one text string is required.');
    }
    const timeout = params.timeout ?? 5_000;
    const visibleOnly = params.visible ?? false;
    await page.waitForFunction(
      ({
        targets,
        requireVisible,
      }: {
        targets: string[];
        requireVisible: boolean;
      }) => {
        const isVisible = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const checkNodeText = (node: Element): boolean => {
          const ariaLabel = node.getAttribute('aria-label');
          const title = node.getAttribute('title');
          const alt = node.getAttribute('alt');
          const rawText = requireVisible
            ? ((node as HTMLElement).innerText ?? node.textContent ?? '')
            : (node.textContent ?? '');
          for (const target of targets) {
            if (
              ariaLabel === target ||
              title === target ||
              alt === target ||
              rawText.includes(target)
            ) {
              if (!requireVisible || isVisible(node)) {
                return true;
              }
            }
          }
          return false;
        };

        if (!document.body) {
          return false;
        }
        if (!requireVisible) {
          const bodyText = document.body.textContent ?? '';
          if (targets.some(t => bodyText.includes(t))) {
            return true;
          }
        }
        const elements = document.body.querySelectorAll('*');
        for (const el of Array.from(elements)) {
          if (checkNodeText(el)) {
            return true;
          }
        }
        return checkNodeText(document.body);
      },
      {targets: texts, requireVisible: visibleOnly},
      {timeout},
    );
  }

  /**
   * 同步页面列表并在必要时回退选中第一个可用页面。
   */
  async syncPages(): Promise<Page[]> {
    const context = this._context;
    if (context) {
      return this.reconcilePages(context.pages());
    } else {
      const browser = this.getBrowser();
      if (browser) {
        return this.reconcilePages(
          browser.contexts().flatMap(ctx => ctx.pages()),
        );
      }
    }
    return this.reconcilePages(this.pagesList);
  }

  getSelectedPageIndex(): number | null {
    const page = this.selectedPage;
    if (!page) return null;
    const index = this.getPages().indexOf(page);
    return index >= 0 ? index : null;
  }

  getSelectedPage(): Page | null {
    return this.selectedPage;
  }

  /**
   * 设置选中页但不做 Dialog/Timeout 副作用（用于底层状态同步）。
   */
  setSelectedPage(page: Page | null): void {
    this.selectedPage = page;
    this.selectedFrame = page?.mainFrame() ?? null;
  }

  /**
   * 切换选中页，并负责 Dialog 监听器迁移与超时更新。
   */
  selectPage(page: Page): void {
    const oldPage = this.selectedPage;
    if (oldPage && oldPage !== page) {
      try {
        oldPage.off('dialog', this._dialogHandler);
      } catch {
        // ignore
      }
    }
    this.setSelectedPage(page);
    page.on('dialog', this._dialogHandler);
    this._updateSelectedPageTimeouts();
  }

  async bringPageToFront(page: Page): Promise<void> {
    await page.bringToFront();
  }

  syncPageContext(page: Page): void {
    this.setSelectedPage(page);
  }

  async getActivePage(): Promise<Page> {
    if (this.selectedPage && !this.selectedPage.isClosed()) {
      return this.selectedPage;
    }
    const pages = this.getPages();
    const activePage = pages.find(p => !p.isClosed()) ?? null;
    if (activePage) {
      this.selectedPage = activePage;
      return activePage;
    }
    throw new Error('没有可用的页面');
  }

  // ─── Frame 管理 ─────────────────────────────────────

  getSelectedFrame(): Frame | null {
    return this.selectedFrame;
  }

  setSelectedFrame(frame: Frame | null): void {
    this.selectedFrame = frame;
  }

  /**
   * 按索引选择 Frame，返回选中的 Frame；返回 null 表示索引越界或无页面。
   */
  selectFrameByIdx(frameIdx: number): Frame | null {
    const page = this.selectedPage;
    if (!page) return null;
    const frames = page.frames();
    if (frameIdx < 0 || frameIdx >= frames.length) return null;
    this.selectedFrame = frames[frameIdx]!;
    return this.selectedFrame;
  }

  // ─── Dialog ─────────────────────────────────────────

  private _dialogHandler = (dialog: Dialog): void => {
    this._dialog = dialog;
  };

  getDialog(): Dialog | undefined {
    return this._dialog;
  }

  clearDialog(): void {
    this._dialog = undefined;
  }

  detachDialogListener(): void {
    if (this.selectedPage) {
      try {
        this.selectedPage.off('dialog', this._dialogHandler);
      } catch {
        // ignore
      }
    }
  }

  // ─── 网络/CPU 节流 ───────────────────────────────────

  setNetworkConditions(conditions: string | null): void {
    const page = this.selectedPage;
    if (!page) return;
    if (conditions === null) {
      this._networkConditionsMap.delete(page);
    } else {
      this._networkConditionsMap.set(page, conditions);
    }
    this._updateSelectedPageTimeouts();
  }

  getNetworkConditions(): string | null {
    const page = this.selectedPage;
    if (!page) return null;
    return this._networkConditionsMap.get(page) ?? null;
  }

  setCpuThrottlingRate(rate: number): void {
    const page = this.selectedPage;
    if (!page) return;
    this._cpuThrottlingRateMap.set(page, rate);
    this._updateSelectedPageTimeouts();
  }

  getCpuThrottlingRate(): number {
    const page = this.selectedPage;
    if (!page) return 1;
    return this._cpuThrottlingRateMap.get(page) ?? 1;
  }

  private _updateSelectedPageTimeouts(): void {
    const page = this.selectedPage;
    if (!page) return;
    const cpuMultiplier = this.getCpuThrottlingRate();
    page.setDefaultTimeout(DEFAULT_TIMEOUT * cpuMultiplier);

    const networkMultiplier = getNetworkMultiplierFromString(
      this.getNetworkConditions(),
    );
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT * networkMultiplier);
  }

  // ─── 生命周期 ────────────────────────────────────────

  dispose(): void {
    this.detachDialogListener();
    this.clearContext();
    this._networkConditionsMap = new WeakMap();
    this._cpuThrottlingRateMap = new WeakMap();
    for (const isoCtx of this._isolatedContexts.values()) {
      void isoCtx.close().catch(() => undefined);
    }
    this._isolatedContexts.clear();
  }

  /**
   * 候选查询页面：优先当前选中页，其次其他页面。
   */
  getCandidatePages(): Page[] {
    return this.selectedPage
      ? [
          this.selectedPage,
          ...this.getPages().filter(p => p !== this.selectedPage),
        ]
      : this.getPages();
  }

  private ensurePageId(page: Page): string {
    let pageId = this.pageIds.get(page);
    if (!pageId) {
      pageId = String(this.nextPageId++);
      this.pageIds.set(page, pageId);
    }
    this.pagesById.set(pageId, page);
    return pageId;
  }

  private reconcilePages(pages: Page[]): Page[] {
    const activePages = pages.filter(page => !page.isClosed());
    const activeSet = new Set(activePages);
    for (const page of activePages) {
      this.ensurePageId(page);
    }
    for (const [pageId, page] of this.pagesById) {
      if (!activeSet.has(page)) {
        this.pagesById.delete(pageId);
      }
    }
    this.pagesList = activePages;

    if (!this.selectedPage || !activeSet.has(this.selectedPage)) {
      const firstAvailable = activePages[0];
      if (firstAvailable) {
        this.setSelectedPage(firstAvailable);
      } else {
        this.setSelectedPage(null);
      }
    }
    return this.pagesList;
  }

  private wasIssuedPageId(pageId: string): boolean {
    const normalized = normalizePageId(pageId);
    if (!/^\d+$/.test(normalized)) return false;
    const value = Number(normalized);
    return value >= 1 && value < this.nextPageId;
  }

  private resetPageIdentityState(): void {
    this.pageIds = new WeakMap();
    this.pagesById.clear();
    this.pagesList = [];
    this.setSelectedPage(null);
  }
}
