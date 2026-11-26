/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SessionContext — 守护进程级浏览器运行时聚合根（ADR-0008）
 *
 * 取代历史上碎片化的 ToolContextProvider + BrowserContextProvider +
 * DebuggerContextProvider + ServiceLocator + DefineToolContextFactory + getRuntime()：
 * - 持有浏览器连接、默认与隔离 BrowserContext、稳定 pageId 分配与 1:1 BrowserPage 表
 * - 持有跨页复用资产（HookTypeRegistry / PersistentHookRegistry / CodeCollector 共享缓存 /
 *   WasmAnalyzer / WasmDecompiler / PageSnapshotManager /
 *   PageHealthTracker / ExtensionManager）
 * - 通过 `toToolContext(targetPage?)` 为工具执行生成绑定目标 BrowserPage 的 Context 视图
 */

import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Dialog,
  Frame,
  Page,
} from 'patchright';

import {getRuntimeConfigStore} from '../config/RuntimeConfigStore.js';
import {getBrowserManagerConfig} from '../config/servicesConfig.js';
import type {TrafficSummary} from '../formatters/websocketFormatter.js';
import type {EmulateOptions} from '../modules/browser/EmulationManager.js';
import {
  BrowserManager,
  BrowserTargetInspector,
} from '../modules/browser/index.js';
import {
  normalizePageId,
  type PageSelector,
  type ResolvedPage,
} from '../modules/browser/PageIdentity.js';
import type {
  WaitForEventsOptions,
  WaitForEventsResult,
} from '../modules/browser/WaitForHelper.js';
import {CodeCollector} from '../modules/collector/CodeCollector.js';
import {DOMInspector} from '../modules/collector/DOMInspector.js';
import {PageController} from '../modules/collector/PageController.js';
import type {DebuggerManager} from '../modules/debugger/DebuggerManager.js';
import type {
  Logpoint,
  LogpointOptions,
} from '../modules/debugger/LogpointManager.js';
import {ExtensionManager} from '../modules/extension/ExtensionManager.js';
import {
  HookManager,
  type HookTypeRegistry,
  type PersistentHookRegistry,
} from '../modules/hook/index.js';
import {NetworkModule} from '../modules/network/index.js';
import type {
  NetworkMockFilter,
  NetworkMockInput,
  NetworkOverride,
} from '../modules/network/NetworkMockManager.js';
import type {
  RequestInitiator,
  WebSocketData,
} from '../modules/network/NetworkTypes.js';
import {
  globalPageSnapshotManager,
  type PageSnapshotManager,
} from '../modules/snapshot/PageSnapshotManager.js';
import {WasmAnalyzer} from '../modules/wasm/WasmAnalyzer.js';
import {WasmCollector} from '../modules/wasm/WasmCollector.js';
import {WasmDecompiler} from '../modules/wasm/WasmDecompiler.js';
import {WasmRuntimeInspector} from '../modules/wasm/WasmRuntimeInspector.js';
import type {Runtime} from '../runtime.js';
import type {HTTPRequest} from '../third_party/index.js';
import type {
  Context,
  ContextPage,
  Extension,
  NewPageOptions,
} from '../tools/ToolDefinition.js';
import {createAppEventBusOptions, type AppEventMap} from '../types/events.js';
import {EventBus} from '../utils/EventBus.js';
import {validateOutputPath} from '../utils/fsSafe.js';

import {BrowserPage} from './BrowserPage.js';
import type {
  ConsoleMessageCollector,
  NetworkRequestCollector,
  WsCollector,
} from './collectors.js';
import {CollectorContextProvider} from './context/CollectorContextProvider.js';
import {
  globalPageHealthTracker,
  type PageHealthTracker,
} from './context/PageHealthTracker.js';
import {wrapFrameWithTimeout} from './timeoutUtils.js';
import type {ToolTabContext} from './ToolCallContextGuard.js';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpeg',
  'image/webp': '.webp',
};

export interface SessionContextOptions {
  runtime?: Runtime;
  snapshotManager?: PageSnapshotManager;
  healthTracker?: PageHealthTracker;
}

export class SessionContext {
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _browserManager: BrowserManager | null = null;
  private _browserConnector?: () => Promise<Browser | null>;

  private readonly _collectorContext = new CollectorContextProvider();
  private readonly _snapshotManager: PageSnapshotManager;
  private readonly _healthTracker: PageHealthTracker;
  private readonly _isolatedContexts = new Map<string, BrowserContext>();
  private readonly _trafficSummaryCache = new Map<number, TrafficSummary>();

  // 1:1 Page -> BrowserPage 聚合根表
  private _browserPages = new WeakMap<Page, BrowserPage>();
  private readonly _browserPagesById = new Map<string, BrowserPage>();
  private _pagesList: Page[] = [];
  private _selectedPage: BrowserPage | null = null;
  private _detachedSelectedFrame: Frame | null = null;
  private _nextPageId = 1;

  // Session 级跨页复用服务（按需惰性创建）
  private _runtime?: Runtime;
  private _codeCollector?: CodeCollector;
  private _domInspector?: DOMInspector;
  private _pageController?: PageController;
  private _hookManager?: HookManager;
  private _networkModule?: NetworkModule;
  private _wasmAnalyzer?: WasmAnalyzer;
  private _wasmDecompiler?: WasmDecompiler;
  private _wasmRuntimeInspector?: WasmRuntimeInspector;
  private _wasmCollector?: WasmCollector;
  private _browserTargetInspector?: BrowserTargetInspector;
  private _extensionManager?: ExtensionManager;

  private _isDisposed = false;
  private _activeSessionId?: string;
  public readonly eventBus: EventBus<AppEventMap>;

  constructor(runtimeOrOptions?: Runtime | SessionContextOptions) {
    const isOptions =
      runtimeOrOptions !== undefined &&
      ('runtime' in runtimeOrOptions ||
        'snapshotManager' in runtimeOrOptions ||
        'healthTracker' in runtimeOrOptions) &&
      !('browserManager' in runtimeOrOptions);

    const options: SessionContextOptions = isOptions
      ? (runtimeOrOptions as SessionContextOptions)
      : {runtime: runtimeOrOptions as Runtime | undefined};

    this._runtime = options.runtime;
    this._snapshotManager =
      options.snapshotManager ?? globalPageSnapshotManager;
    this._healthTracker = options.healthTracker ?? globalPageHealthTracker;

    if (options.runtime) {
      this._browserManager = options.runtime.browserManager;
      this._codeCollector = options.runtime.collector;
      this._domInspector = options.runtime.domInspector;
      this._pageController = options.runtime.pageController;
      this._hookManager = options.runtime.hookManager;
    }

    this.eventBus =
      options.runtime?.eventBus ??
      new EventBus<AppEventMap>(createAppEventBusOptions());
  }

  // ─── 生命周期 ────────────────────────────────────────

  async init(): Promise<void> {
    if (this._isDisposed) {
      throw new Error('SessionContext 已销毁，无法重新初始化');
    }
    await this.syncPages();
    this.syncBrowserState();
  }

  private syncBrowserState(): void {
    const context = this.getContext();
    if (context) {
      this._collectorContext.start(context);
    }

    if (!this._selectedPage) {
      const currentPage = this._browserManager?.getCurrentPage();
      if (currentPage && !currentPage.isClosed()) {
        this._selectedPage = this.getOrCreateBrowserPage(currentPage);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    this._isDisposed = true;

    const pagesToDispose = Array.from(this._browserPagesById.values());
    for (const bp of pagesToDispose) {
      await bp.dispose().catch(err => {
        console.error('[SessionContext] 释放 BrowserPage 失败:', err);
      });
    }

    this._collectorContext.dispose();
    this.clearContext();
    for (const isoCtx of this._isolatedContexts.values()) {
      void isoCtx.close().catch(() => undefined);
    }
    this._isolatedContexts.clear();
    this._trafficSummaryCache.clear();
  }

  setActiveSession(id: string): void {
    this._activeSessionId = id;
  }

  clearActiveSession(): void {
    this._activeSessionId = undefined;
  }

  getActiveSession(): string | undefined {
    return this._activeSessionId;
  }

  // ─── Browser / BrowserContext 管理 ───────────────────

  setBrowser(browser: Browser | null): void {
    if (this._browser === browser) return;
    this._browser = browser;
    if (browser && typeof browser.once === 'function') {
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

  setBrowserConnector(connector: () => Promise<Browser | null>): void {
    this._browserConnector = connector;
  }

  setContext(context: BrowserContext): void {
    if (this._context !== context) {
      this.resetPageIdentityState();
      this._context = context;
      this._collectorContext.start(context);
      return;
    }
    this._context = context;
    this._collectorContext.start(context);
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

  getBrowserContext(): BrowserContext | null {
    return this.getContext();
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
          this.syncBrowserState();
          return browser;
        }
      } catch {
        // 连接失败保持未连接状态
      }
    }
    if (this._browserConnector) {
      const browser = await this._browserConnector().catch(() => null);
      if (browser) {
        this.syncBrowserState();
      }
      return browser;
    }
    return null;
  }

  async isCollectorRunning(): Promise<boolean> {
    return this.getContext() !== null;
  }

  // ─── BrowserPage 聚合根管理 ─────────────────────────

  getOrCreateBrowserPage(page: Page): BrowserPage {
    let bp = this._browserPages.get(page);
    if (!bp) {
      const pageId = String(this._nextPageId++);
      bp = new BrowserPage(pageId, page, {
        collectors: this._collectorContext,
        snapshotManager: this._snapshotManager,
        healthTracker: this._healthTracker,
      });
      this._browserPages.set(page, bp);
    }
    this._browserPagesById.set(bp.id, bp);
    return bp;
  }

  getSelectedBrowserPage(): BrowserPage | null {
    return this._selectedPage;
  }

  getBrowserPageById(pageId: string): BrowserPage | undefined {
    this.getPages();
    return this._browserPagesById.get(normalizePageId(pageId));
  }

  resolveBrowserPage(selector?: PageSelector): BrowserPage {
    const resolved = this.resolvePage(selector ?? {fallbackToSelected: true});
    return this.getOrCreateBrowserPage(resolved.page);
  }

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
    return this.reconcilePages(this._pagesList);
  }

  async syncPages(): Promise<Page[]> {
    const context = this._context;
    if (context) {
      return this.reconcilePages(context.pages());
    }
    const browser = this.getBrowser();
    if (browser) {
      return this.reconcilePages(
        browser.contexts().flatMap(ctx => ctx.pages()),
      );
    }
    return this.reconcilePages(this._pagesList);
  }

  setPages(pages: Page[]): void {
    this.reconcilePages(pages);
  }

  getPageId(page: Page): string {
    const pages = this.getPages();
    if (!pages.includes(page)) {
      throw new Error('页面不属于当前 BrowserContext，请重新调用 list_pages');
    }
    return this.getOrCreateBrowserPage(page).id;
  }

  resolvePage(selector: PageSelector): ResolvedPage {
    const pages = this.getPages();
    let pageById: Page | undefined;
    let pageByIdx: Page | undefined;

    if (selector.pageId !== undefined) {
      const normalizedId = normalizePageId(selector.pageId);
      pageById = this._browserPagesById.get(normalizedId)?.rawPage;
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
      page = this._selectedPage?.rawPage ?? undefined;
      if (!page) {
        throw new Error('当前没有选中的页面，请先调用 new_page 或 select_page');
      }
    }

    const pageIdx = pages.indexOf(page);
    if (pageIdx < 0) {
      throw new Error('当前没有选中的页面，请先调用 new_page 或 select_page');
    }
    return {page, pageId: this.getOrCreateBrowserPage(page).id, pageIdx};
  }

  getPageByIdx(idx: number): Page {
    return this.resolvePage({pageIdx: idx}).page;
  }

  getSelectedPage(): Page | null {
    return this._selectedPage?.rawPage ?? null;
  }

  setSelectedPage(page: Page | null): void {
    if (!page) {
      this._selectedPage = null;
      return;
    }
    const bp = this.getOrCreateBrowserPage(page);
    bp.selectFrame(
      typeof page.mainFrame === 'function' ? page.mainFrame() : null,
    );
    this._selectedPage = bp;
    this._detachedSelectedFrame = null;
  }

  selectPage(page: Page): void {
    const bp = this.getOrCreateBrowserPage(page);
    bp.selectFrame(
      typeof page.mainFrame === 'function' ? page.mainFrame() : null,
    );
    bp.attachDialogListener();
    bp.updateTimeouts();
    bp.ensureFocusEmulation();
    this._selectedPage = bp;
    this._detachedSelectedFrame = null;
  }

  async bringPageToFront(page: Page): Promise<void> {
    await this.getOrCreateBrowserPage(page).bringToFront();
  }

  syncPageContext(page: Page): void {
    this.setSelectedPage(page);
    this._browserManager?.setCurrentPage(page);
    this._codeCollector?.setPageResolver(() => page);
  }

  async getActivePage(): Promise<Page> {
    if (this._selectedPage && !this._selectedPage.isClosed()) {
      return this._selectedPage.rawPage;
    }
    const pages = this.getPages();
    const activePage = pages.find(p => !p.isClosed()) ?? null;
    if (activePage) {
      this._selectedPage = this.getOrCreateBrowserPage(activePage);
      return activePage;
    }
    throw new Error('没有可用的页面');
  }

  async getActiveBrowserPage(): Promise<BrowserPage> {
    const page = await this.getActivePage();
    return this.getOrCreateBrowserPage(page);
  }

  getSelectedPageIndex(): number | null {
    const page = this.getSelectedPage();
    if (!page) return null;
    const index = this.getPages().indexOf(page);
    return index >= 0 ? index : null;
  }

  getContextMeta(): ToolTabContext {
    const page = this.getSelectedPage();
    const pages = this.getPages();
    const tabIndex = page ? pages.indexOf(page) : null;
    const pageId =
      page && tabIndex !== null && tabIndex >= 0 ? this.getPageId(page) : null;
    return {
      url: page?.url() ?? null,
      title: null,
      tabIndex,
      pageId,
    };
  }

  getContextMetaForPage(bp: BrowserPage): ToolTabContext {
    const page = bp.rawPage;
    const pages = this.getPages();
    const idx = pages.indexOf(page);
    return {
      url: typeof page.url === 'function' ? page.url() : null,
      title: null,
      tabIndex: idx >= 0 ? idx : null,
      pageId: bp.id,
    };
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
    if (!options?.background || !this._selectedPage) {
      this.selectPage(page);
    }
    if (!this._collectorContext.isStarted()) {
      this._collectorContext.attachPage(page);
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

    const bp = this._browserPages.get(resolved.page);
    if (bp) {
      await bp.dispose().catch(() => undefined);
      this._browserPagesById.delete(bp.id);
    }
    await resolved.page.close();
    await this.syncPages();
  }

  // ─── Frame / Dialog / Emulation / Wait / Mock / Logpoint（委托给目标 BrowserPage） ───

  getSelectedFrame(): Frame | null {
    if (!this._selectedPage) return this._detachedSelectedFrame ?? null;
    return this._selectedPage.getSelectedFrameOrNull();
  }

  setSelectedFrame(frame: Frame | null): void {
    if (this._selectedPage) {
      this._selectedPage.selectFrame(frame);
    } else {
      this._detachedSelectedFrame = frame;
    }
  }

  selectFrameByIdx(frameIdx: number): Frame | null {
    return this._selectedPage?.selectFrameByIdx(frameIdx) ?? null;
  }

  getDialog(): Dialog | undefined {
    return this._selectedPage?.getDialog();
  }

  clearDialog(): void {
    this._selectedPage?.clearDialog();
  }

  setNetworkConditions(conditions: string | null): void {
    this._selectedPage?.setNetworkConditions(conditions);
  }

  getNetworkConditions(): string | null {
    return this._selectedPage?.getNetworkConditions() ?? null;
  }

  setCpuThrottlingRate(rate: number): void {
    this._selectedPage?.setCpuThrottlingRate(rate);
  }

  getCpuThrottlingRate(): number {
    return this._selectedPage?.getCpuThrottlingRate() ?? 1;
  }

  async emulate(options: EmulateOptions): Promise<void> {
    const bp = await this.getActiveBrowserPage();
    await bp.emulate(options);
  }

  async waitForEventsAfterAction(
    action: (signal: AbortSignal) => Promise<unknown>,
    options?: WaitForEventsOptions,
  ): Promise<WaitForEventsResult> {
    const bp = await this.getActiveBrowserPage();
    return await bp.waitForEventsAfterAction(action, options);
  }

  async waitForTextOnPage(params: {
    text: string | string[];
    timeout?: number;
    visible?: boolean;
  }): Promise<void> {
    const bp = await this.getActiveBrowserPage();
    await bp.waitForTextOnPage(params);
  }

  async mockNetwork(input: NetworkMockInput): Promise<NetworkOverride> {
    const bp = await this.getActiveBrowserPage();
    return await bp.mockNetwork(input);
  }

  listNetworkMocks(filter?: NetworkMockFilter): NetworkOverride[] {
    return this._selectedPage?.listNetworkMocks(filter) ?? [];
  }

  async removeNetworkMocks(filter: NetworkMockFilter): Promise<number> {
    const bp = await this.getActiveBrowserPage();
    return await bp.removeNetworkMocks(filter);
  }

  async setLogpoints(desired: LogpointOptions[]): Promise<Logpoint[]> {
    const bp = await this.getActiveBrowserPage();
    return await bp.setLogpoints(desired);
  }

  getLogpoints(): Logpoint[] {
    return this._selectedPage?.getLogpoints() ?? [];
  }

  async getDebuggerContext(page?: Page): Promise<DebuggerManager> {
    const target = page
      ? this.getOrCreateBrowserPage(page)
      : await this.getActiveBrowserPage();
    return await target.ensureDebugger();
  }

  getExistingDebuggerContext(page?: Page): DebuggerManager | undefined {
    const target = page
      ? this._browserPages.get(page)
      : (this._selectedPage ?? undefined);
    return target?.getExistingDebugger();
  }

  async disposeDebuggerContext(page?: Page): Promise<void> {
    const target = page
      ? this._browserPages.get(page)
      : (this._selectedPage ?? undefined);
    await target?.disposeDebugger();
  }

  // ─── Collectors ─────────────────────────────────────

  get networkCollector(): NetworkRequestCollector {
    return this._collectorContext.networkCollector;
  }

  get consoleCollector(): ConsoleMessageCollector {
    return this._collectorContext.consoleCollector;
  }

  get wsCollector(): WsCollector {
    return this._collectorContext.wsCollector;
  }

  get snapshotManager(): PageSnapshotManager {
    return this._snapshotManager;
  }

  get healthTracker(): PageHealthTracker {
    return this._healthTracker;
  }

  private getCandidatePages(primary?: Page | null): Page[] {
    const lead = primary ?? this.getSelectedPage();
    return lead
      ? [lead, ...this.getPages().filter(p => p !== lead)]
      : this.getPages();
  }

  private resolveNetworkPage(pageIdx?: number): Page | null {
    if (typeof pageIdx === 'number') {
      return this.getPageByIdx(pageIdx);
    }
    return this.getSelectedPage();
  }

  getNetworkRequests(
    includePreservedRequests?: boolean,
    pageIdx?: number,
  ): HTTPRequest[] {
    const page = this.resolveNetworkPage(pageIdx);
    return this._collectorContext.getNetworkRequests(
      page,
      includePreservedRequests,
    );
  }

  getNetworkRequestsForPage(
    page: Page,
    includePreservedRequests?: boolean,
  ): HTTPRequest[] {
    return this._collectorContext.getNetworkRequests(
      page,
      includePreservedRequests,
    );
  }

  getNetworkRequestById(reqid: number, primaryPage?: Page): HTTPRequest {
    return this._collectorContext.getNetworkRequestById(
      this.getCandidatePages(primaryPage),
      reqid,
    );
  }

  clearNetworkRequests(pageIdx?: number): void {
    const page = this.resolveNetworkPage(pageIdx);
    this._collectorContext.clearNetworkRequests(page);
  }

  clearNetworkRequestsForPage(page: Page): void {
    this._collectorContext.clearNetworkRequests(page);
  }

  getNetworkRequestStableId(request: unknown, primaryPage?: Page): number {
    return this._collectorContext.getNetworkRequestStableId(
      this.getCandidatePages(primaryPage),
      request,
    );
  }

  getRequestInitiator(request: unknown): RequestInitiator | undefined {
    const req = request as {initiator?: () => RequestInitiator};
    return typeof req.initiator === 'function' ? req.initiator() : undefined;
  }

  async getDevToolsData(): Promise<undefined> {
    return undefined;
  }

  resolveCdpRequestId(_cdpRequestId: string): undefined {
    return undefined;
  }

  async ensureConsoleEnabled(page?: Page): Promise<void> {
    await this._collectorContext.ensureConsoleEnabled(
      page ?? this.getSelectedPage(),
    );
  }

  getConsoleData(
    includePreservedMessages?: boolean,
    page?: Page,
  ): Array<ConsoleMessage | Error> {
    return this._collectorContext.getConsoleData(
      page ?? this.getSelectedPage(),
      includePreservedMessages,
    );
  }

  getConsoleMessageById(id: number, page?: Page): ConsoleMessage | Error {
    return this._collectorContext.getConsoleMessageById(
      page ?? this.getSelectedPage(),
      id,
    );
  }

  getConsoleMessageStableId(message: unknown, primaryPage?: Page): number {
    return this._collectorContext.getConsoleMessageStableId(
      this.getCandidatePages(primaryPage),
      message,
    );
  }

  getWebSocketConnections(
    includePreservedData?: boolean,
    page?: Page,
  ): WebSocketData[] {
    return this._collectorContext.getWebSocketConnections(
      page ?? this.getSelectedPage(),
      includePreservedData,
    );
  }

  getWebSocketConnectionById(wsid: number, page?: Page): WebSocketData {
    return this._collectorContext.getWebSocketConnectionById(
      page ?? this.getSelectedPage(),
      wsid,
    );
  }

  getWebSocketStableId(ws: unknown, primaryPage?: Page): number {
    return this._collectorContext.getWebSocketStableId(
      this.getCandidatePages(primaryPage),
      ws,
    );
  }

  // ─── Session 级跨页资产与服务（ADR-0008） ────────────

  getBrowserTargetInspector(): BrowserTargetInspector {
    this._browserTargetInspector ??= new BrowserTargetInspector(() =>
      this.getBrowser(),
    );
    return this._browserTargetInspector;
  }

  get collector(): CodeCollector {
    return this.getCodeCollector();
  }

  getCodeCollector(): CodeCollector {
    if (this._codeCollector) return this._codeCollector;
    if (this._runtime?.collector) {
      this._codeCollector = this._runtime.collector;
      return this._codeCollector;
    }
    const mgr =
      this._browserManager ??
      BrowserManager.getInstance(getBrowserManagerConfig());
    const config = {
      timeout: 30000,
      maxCollectedUrls: 10000,
      maxFilesPerCollect: 200,
      maxTotalContentSize: 512 * 1024,
      maxSingleFileSize: 200 * 1024,
    };
    this._codeCollector = new CodeCollector(config, mgr);
    this._codeCollector.setPageResolver(() => this.getSelectedPage());
    return this._codeCollector;
  }

  getDOMInspector(): DOMInspector {
    return (this._domInspector ??=
      this._runtime?.domInspector ?? new DOMInspector(this.getCodeCollector()));
  }

  get pageController(): PageController {
    return this.getPageController();
  }

  getPageController(): PageController {
    return (this._pageController ??=
      this._runtime?.pageController ??
      new PageController(this.getCodeCollector()));
  }

  get hookManager(): HookManager {
    return this.getHookManager();
  }

  getHookManager(): HookManager {
    return (this._hookManager ??=
      this._runtime?.hookManager ?? new HookManager());
  }

  getHookTypeRegistry(): HookTypeRegistry {
    return this.getHookManager().getRegistry();
  }

  getPersistentHookRegistry(): PersistentHookRegistry {
    return this.getHookManager().getPersistentHookRegistry();
  }

  getNetworkModule(): NetworkModule {
    return (this._networkModule ??=
      this._runtime?.networkModule ?? new NetworkModule());
  }

  getWasmAnalyzer(): WasmAnalyzer {
    return (this._wasmAnalyzer ??=
      this._runtime?.wasmAnalyzer ?? new WasmAnalyzer());
  }

  getWasmDecompiler(): WasmDecompiler {
    return (this._wasmDecompiler ??=
      this._runtime?.wasmDecompiler ?? new WasmDecompiler());
  }

  getWasmRuntimeInspector(): WasmRuntimeInspector {
    return (this._wasmRuntimeInspector ??=
      this._runtime?.wasmRuntimeInspector ?? new WasmRuntimeInspector());
  }

  getWasmCollector(): WasmCollector {
    return (this._wasmCollector ??=
      this._runtime?.wasmCollector ??
      new WasmCollector(
        this.getPageController(),
        this.getWasmAnalyzer(),
        this.getWasmRuntimeInspector(),
      ));
  }

  getExtensionManager(): ExtensionManager {
    return (this._extensionManager ??= new ExtensionManager({
      getBrowser: () => this.getBrowser(),
      getSelectedPage: () => this.getSelectedPage(),
    }));
  }

  async installExtension(filePath: string): Promise<string> {
    return this.getExtensionManager().installExtension(filePath);
  }

  async uninstallExtension(id: string): Promise<void> {
    return this.getExtensionManager().uninstallExtension(id);
  }

  async listExtensions(): Promise<Map<string, Extension>> {
    return this.getExtensionManager().listExtensions();
  }

  async getExtension(id: string): Promise<Extension | undefined> {
    return this.getExtensionManager().getExtension(id);
  }

  async triggerExtensionAction(id: string): Promise<void> {
    return this.getExtensionManager().triggerExtensionAction(id);
  }

  // ─── Context 视图构造（替代 DefineToolContextFactory） ───

  toToolContext(targetPage?: BrowserPage): Context {
    const resolveTarget = (): BrowserPage | null =>
      targetPage ?? this._selectedPage;

    return {
      getBrowserTargetInspector: () => this.getBrowserTargetInspector(),
      getTargetPage: (): ContextPage | null => resolveTarget(),
      resolveBrowserPage: (selector?: PageSelector): ContextPage =>
        this.resolveBrowserPage(selector),
      getSelectedPage: () => {
        const page = resolveTarget()?.rawPage ?? null;
        if (!page) throw new Error('没有选中的页面');
        return page;
      },
      getBrowserContext: () => this.getContext(),
      getPersistentHookRegistry: () => this.getPersistentHookRegistry(),
      getDialog: () => resolveTarget()?.getDialog(),
      clearDialog: () => resolveTarget()?.clearDialog(),
      getPageByIdx: idx => this.getPageByIdx(idx),
      getPageId: page => this.getPageId(page),
      resolvePage: selector => this.resolvePage(selector),
      isPageSelected: page => this.getSelectedPage() === page,
      newPage: options => this.newPage(options),
      closePage: async (pageIdx: number) => {
        await this.closePage(pageIdx);
      },
      closePageBySelector: async selector => {
        await this.closePage(selector);
      },
      selectPage: page => this.selectPage(page),
      bringPageToFront: page => this.bringPageToFront(page),
      syncPageContext: page => this.syncPageContext(page),
      getPages: () => this.getPages(),
      isBrowserConnected: () => this.isBrowserConnected(),
      ensureConnectedBrowser: () => this.ensureConnectedBrowser(),
      getSelectedFrame: () => {
        const frame =
          resolveTarget()?.getSelectedFrameOrNull() ?? this.getSelectedFrame();
        if (!frame) {
          throw new Error('没有可用的 Frame，可能页面未选中或已关闭');
        }
        return wrapFrameWithTimeout(frame);
      },
      selectFrame: frame => {
        const bp = resolveTarget();
        if (bp) bp.selectFrame(frame);
        else this.setSelectedFrame(frame);
      },
      resetSelectedFrame: () => {
        const bp = resolveTarget();
        if (bp) bp.selectFrame(null);
        else this.setSelectedFrame(null);
      },
      setNetworkConditions: conditions =>
        resolveTarget()?.setNetworkConditions(conditions),
      setCpuThrottlingRate: rate => resolveTarget()?.setCpuThrottlingRate(rate),
      emulate: async options => {
        const bp = resolveTarget() ?? (await this.getActiveBrowserPage());
        await bp.emulate(options);
      },
      saveTemporaryFile: async (data, mimeType) => {
        const ext = MIME_TO_EXT[mimeType] ?? '.bin';
        const dir = await mkdtemp(path.join(os.tmpdir(), 'browsercli-'));
        const filename = path.join(dir, `artifact${ext}`);
        await writeFile(filename, data);
        return {filename};
      },
      saveFile: async (data, filename) => {
        const resolved = validateOutputPath(filename);
        await mkdir(path.dirname(resolved), {recursive: true});
        await writeFile(resolved, data);
        return {filename: resolved};
      },
      ensureExtension: async <Extension extends `.${string}`>(
        filePath: string,
        extension: Extension,
      ): Promise<`${string}${Extension}`> => {
        const resolved = validateOutputPath(filePath);
        const currentExtension = path.extname(resolved);
        return `${resolved.slice(
          0,
          resolved.length - currentExtension.length,
        )}${extension}`;
      },
      getScreencastFps: () => {
        const cfg = getRuntimeConfigStore().get();
        return (
          cfg.screencastFps ??
          cfg.experimentalScreencastFps ??
          cfg.browser?.screencastFps ??
          cfg.browser?.experimentalScreencastFps
        );
      },
      waitForEventsAfterAction: async (action, options) => {
        const bp = resolveTarget() ?? (await this.getActiveBrowserPage());
        return await bp.waitForEventsAfterAction(action, options);
      },
      waitForTextOnPage: async params => {
        const bp = resolveTarget() ?? (await this.getActiveBrowserPage());
        await bp.waitForTextOnPage(params);
      },
      getDevToolsData: () => this.getDevToolsData(),
      resolveCdpRequestId: cdpRequestId =>
        this.resolveCdpRequestId(cdpRequestId),
      getDebuggerContext: async () => {
        const bp = resolveTarget() ?? (await this.getActiveBrowserPage());
        return await bp.ensureDebugger();
      },
      getExistingDebuggerContext: () => resolveTarget()?.getExistingDebugger(),
      getRequestInitiator: request => this.getRequestInitiator(request),
      getRequestInitiatorById: _requestId => undefined,
      getNetworkRequestById: reqid =>
        this.getNetworkRequestById(reqid, resolveTarget()?.rawPage),
      getNetworkRequests: includePreserved => {
        const bp = resolveTarget();
        return bp
          ? bp.getNetworkRequests(includePreserved)
          : this.getNetworkRequests(includePreserved);
      },
      getNetworkRequestStableId: request =>
        this.getNetworkRequestStableId(request, resolveTarget()?.rawPage),
      clearNetworkRequests: pageIdx => {
        if (typeof pageIdx === 'number') {
          this.clearNetworkRequests(pageIdx);
          return;
        }
        resolveTarget()?.clearNetworkRequests();
      },
      ensureConsoleEnabled: async () => {
        const bp = resolveTarget();
        if (bp) await bp.ensureConsoleEnabled();
        else await this.ensureConsoleEnabled();
      },
      getConsoleData: includePreserved => {
        const bp = resolveTarget();
        return bp
          ? bp.getConsoleData(includePreserved)
          : this.getConsoleData(includePreserved);
      },
      getConsoleMessageById: id =>
        this.getConsoleMessageById(id, resolveTarget()?.rawPage),
      getConsoleMessageStableId: message =>
        this.getConsoleMessageStableId(message, resolveTarget()?.rawPage),
      mockNetwork: async input => {
        const bp = resolveTarget() ?? (await this.getActiveBrowserPage());
        return await bp.mockNetwork(input);
      },
      listNetworkMocks: filter =>
        resolveTarget()?.listNetworkMocks(filter) ?? [],
      removeNetworkMocks: async filter => {
        const bp = resolveTarget() ?? (await this.getActiveBrowserPage());
        return await bp.removeNetworkMocks(filter);
      },
      setLogpoints: async desired => {
        const bp = resolveTarget() ?? (await this.getActiveBrowserPage());
        return await bp.setLogpoints(desired);
      },
      getLogpoints: () => resolveTarget()?.getLogpoints() ?? [],
      getWebSocketConnections: includePreserved => {
        const bp = resolveTarget();
        return bp
          ? bp.getWebSocketConnections(includePreserved)
          : this.getWebSocketConnections(includePreserved);
      },
      getWebSocketById: wsid =>
        this.getWebSocketConnectionById(wsid, resolveTarget()?.rawPage),
      getWebSocketStableId: ws =>
        this.getWebSocketStableId(ws, resolveTarget()?.rawPage),
      cacheTrafficSummary: (wsid, summary) => {
        this._trafficSummaryCache.set(wsid, summary);
      },
      getCachedTrafficSummary: wsid => this._trafficSummaryCache.get(wsid),
      installExtension: filePath => this.installExtension(filePath),
      uninstallExtension: id => this.uninstallExtension(id),
      listExtensions: () => this.listExtensions(),
      getExtension: id => this.getExtension(id),
      triggerExtensionAction: id => this.triggerExtensionAction(id),
      // Session 级显式服务访问器（ADR-0008）
      getBrowserManager: () => this.getBrowserManager(),
      getCodeCollector: () => this.getCodeCollector(),
      getDOMInspector: () => this.getDOMInspector(),
      getPageController: () => this.getPageController(),
      getHookManager: () => this.getHookManager(),
      getHookTypeRegistry: () => this.getHookTypeRegistry(),
      getPageHookStore: () => resolveTarget()?.getHookStore() ?? null,
      getNetworkModule: () => this.getNetworkModule(),
      getNetworkServices: () => {
        if (!targetPage) return this;
        const rawPage = targetPage.rawPage;
        return {
          getPages: () => this.getPages(),
          getSelectedPage: () => rawPage,
          getPageByIdx: idx => this.getPageByIdx(idx),
          getPageId: page => this.getPageId(page),
          resolvePage: selector => {
            if (
              selector.pageId === undefined &&
              selector.pageIdx === undefined &&
              selector.fallbackToSelected
            ) {
              return this.resolvePage({pageId: targetPage.id});
            }
            return this.resolvePage(selector);
          },
          getNetworkRequests: (includePreserved, pageIdx) =>
            typeof pageIdx === 'number'
              ? this.getNetworkRequests(includePreserved, pageIdx)
              : this.getNetworkRequestsForPage(rawPage, includePreserved),
          getNetworkRequestsForPage: (page, includePreserved) =>
            this.getNetworkRequestsForPage(page, includePreserved),
          getNetworkRequestById: reqid =>
            this.getNetworkRequestById(reqid, rawPage),
          getNetworkRequestStableId: request =>
            this.getNetworkRequestStableId(request, rawPage),
          clearNetworkRequests: pageIdx => {
            if (typeof pageIdx === 'number') {
              this.clearNetworkRequests(pageIdx);
              return;
            }
            this.clearNetworkRequestsForPage(rawPage);
          },
          clearNetworkRequestsForPage: page =>
            this.clearNetworkRequestsForPage(page),
          getRequestInitiator: request => this.getRequestInitiator(request),
          getDevToolsData: () => this.getDevToolsData(),
          resolveCdpRequestId: cdpRequestId =>
            this.resolveCdpRequestId(cdpRequestId),
          getWebSocketConnections: includePreserved =>
            this.getWebSocketConnections(includePreserved, rawPage),
          getWebSocketConnectionById: wsid =>
            this.getWebSocketConnectionById(wsid, rawPage),
          getWebSocketStableId: ws => this.getWebSocketStableId(ws, rawPage),
        };
      },
      isCollectorRunning: () => this.isCollectorRunning(),
      recordPageHealthy: (pageId?: string) => {
        const id = pageId ?? resolveTarget()?.id;
        if (id) {
          this._healthTracker.recordSuccess(id);
        }
      },
      getWasmCollector: () => this.getWasmCollector(),
      getWasmAnalyzer: () => this.getWasmAnalyzer(),
      getWasmDecompiler: () => this.getWasmDecompiler(),
      getWasmRuntimeInspector: () => this.getWasmRuntimeInspector(),
      getSnapshotManager: () => this._snapshotManager,
    };
  }

  // ─── 内部页表同步 ────────────────────────────────────

  private reconcilePages(pages: Page[]): Page[] {
    const activePages = pages.filter(page => {
      try {
        return typeof page.isClosed === 'function' ? !page.isClosed() : true;
      } catch {
        return false;
      }
    });
    const activeSet = new Set(activePages);

    for (const page of activePages) {
      this.getOrCreateBrowserPage(page);
    }

    for (const [pageId, bp] of this._browserPagesById) {
      if (!activeSet.has(bp.rawPage)) {
        this._browserPagesById.delete(pageId);
        void bp.dispose().catch(() => undefined);
      }
    }

    this._pagesList = activePages;

    if (!this._selectedPage || !activeSet.has(this._selectedPage.rawPage)) {
      const firstAvailable = activePages[0];
      if (firstAvailable) {
        this.setSelectedPage(firstAvailable);
      } else {
        this._selectedPage = null;
      }
    }
    return this._pagesList;
  }

  private wasIssuedPageId(pageId: string): boolean {
    const normalized = normalizePageId(pageId);
    if (!/^\d+$/.test(normalized)) return false;
    const value = Number(normalized);
    return value >= 1 && value < this._nextPageId;
  }

  private resetPageIdentityState(): void {
    for (const bp of this._browserPagesById.values()) {
      void bp.dispose().catch(() => undefined);
    }
    this._browserPages = new WeakMap();
    this._browserPagesById.clear();
    this._pagesList = [];
    this._selectedPage = null;
  }
}
