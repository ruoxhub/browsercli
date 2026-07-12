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

import type {
  Browser,
  BrowserContext,
  Dialog,
  Frame,
  Page,
} from 'patchright';

import type {BrowserManager} from '../../modules/browser/index.js';

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

  private _dialog?: Dialog;
  private _networkConditionsMap = new WeakMap<Page, string>();
  private _cpuThrottlingRateMap = new WeakMap<Page, number>();

  // ─── Browser / Context ───────────────────────────────

  setBrowser(browser: Browser): void {
    this._browser = browser;
  }

  getBrowser(): Browser | null {
    return this._browser ?? this._browserManager?.getBrowser() ?? null;
  }

  setBrowserManager(browserManager: BrowserManager): void {
    this._browserManager = browserManager;
  }

  getBrowserManager(): BrowserManager | null {
    return this._browserManager;
  }

  setContext(context: BrowserContext): void {
    this._context = context;
  }

  getContext(): BrowserContext | null {
    return this._context;
  }

  isBrowserConnected(): boolean {
    return this._browser?.isConnected() ?? false;
  }

  // ─── Pages ──────────────────────────────────────────

  getPages(): Page[] {
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
    if (!page) {
      throw new Error(
        `页面索引 ${idx} 超出范围 (共 ${pages.length} 个页面)`,
      );
    }
    return page;
  }

  async newPage(): Promise<Page> {
    if (!this._context) throw new Error('BrowserContext 未初始化');
    const page = await this._context.newPage();
    this.pagesList = this._context.pages();
    this.selectPage(page);
    return page;
  }

  /**
   * 同步页面列表并在必要时回退选中第一个可用页面。
   */
  async syncPages(): Promise<Page[]> {
    const context = this._context;
    if (context) {
      this.pagesList = context.pages();
    } else {
      const browser = this.getBrowser();
      if (browser) {
        this.pagesList = browser.contexts().flatMap(ctx => ctx.pages());
      }
    }

    if (
      !this.selectedPage ||
      this.selectedPage.isClosed() ||
      this.pagesList.indexOf(this.selectedPage) === -1
    ) {
      const firstAvailable = this.pagesList.find(p => !p.isClosed());
      if (firstAvailable) {
        this.selectPage(firstAvailable);
      } else {
        this.setSelectedPage(null);
      }
    }

    return this.pagesList;
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
    this._networkConditionsMap = new WeakMap();
    this._cpuThrottlingRateMap = new WeakMap();
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
}
