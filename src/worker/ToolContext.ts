/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Dialog,
  Frame,
  Page,
} from 'patchright';

import {
  BrowserTargetInspector,
  type BrowserManager,
} from '../modules/browser/index.js';
import type {
  PageSelector,
  ResolvedPage,
} from '../modules/browser/PageIdentity.js';
import type {DebuggerManager} from '../modules/debugger/DebuggerManager.js';
import type {PersistentHookRegistry} from '../modules/hook/index.js';
import type {
  RequestInitiator,
  WebSocketData,
} from '../modules/network/NetworkTypes.js';
import type {Runtime} from '../runtime.js';
import type {HTTPRequest} from '../third_party/index.js';
import type {TraceResult} from '../trace-processing/parse.js';
import {createAppEventBusOptions, type AppEventMap} from '../types/events.js';
import {EventBus} from '../utils/EventBus.js';

import type {
  ConsoleMessageCollector,
  NetworkRequestCollector,
  WsCollector,
} from './collectors.js';
import {BrowserContextProvider} from './context/BrowserContextProvider.js';
import {CollectorContextProvider} from './context/CollectorContextProvider.js';
import {DebuggerContextProvider} from './context/DebuggerContextProvider.js';
import {ServiceLocator} from './ServiceLocator.js';
import type {ToolTabContext} from './ToolCallContextGuard.js';

export {ServiceLocator} from './ServiceLocator.js';
export {DefineToolContextFactory} from './DefineToolContextFactory.js';

export class ToolContextProvider {
  private readonly _browserContext = new BrowserContextProvider();
  private readonly _debuggerContext = new DebuggerContextProvider();
  // 无选中页（如 setContext()→resetPageIdentityState() 到 syncPages() 回填之间）
  // 必须降级为「不过滤」，否则该窗口内的 CDP 响应会被全部丢弃。
  private readonly _collectorContext = new CollectorContextProvider(
    () => this._serviceLocator.getCaptureEngine(),
    page => {
      const selected = this._browserContext.getSelectedPage();
      return selected === null || selected === page;
    },
  );
  private readonly _serviceLocator: ServiceLocator;

  private _isRunningPerformanceTrace = false;
  private _traceRecordings: TraceResult[] = [];
  private _isDisposed = false;
  private _browserTargetInspector?: BrowserTargetInspector;
  private activeSessionId?: string;
  public readonly eventBus: EventBus<AppEventMap>;

  constructor(runtime?: Runtime) {
    this._serviceLocator = new ServiceLocator(runtime);
    this.eventBus =
      runtime?.eventBus ??
      new EventBus<AppEventMap>(createAppEventBusOptions());
  }

  async init(): Promise<void> {
    if (this._isDisposed) {
      throw new Error('ToolContextProvider 已销毁，无法重新初始化');
    }
    await this._browserContext.syncPages();

    const context = this._browserContext.getContext();
    if (context) {
      this._collectorContext.start(context);
    }

    if (!this._browserContext.getSelectedPage()) {
      const mgr = this._browserContext.getBrowserManager();
      const currentPage = mgr?.getCurrentPage();
      if (currentPage && !currentPage.isClosed()) {
        this._browserContext.setSelectedPage(currentPage);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    this._isDisposed = true;

    await this._debuggerContext
      .disposeAll(this._browserContext.getPages())
      .catch(err => console.error('[ToolContext] 释放 debugger 失败:', err));
    this._collectorContext.dispose();
    this._browserContext.dispose();
  }

  setActiveSession(id: string): void {
    this.activeSessionId = id;
  }

  clearActiveSession(): void {
    this.activeSessionId = undefined;
  }

  getActiveSession(): string | undefined {
    return this.activeSessionId;
  }

  setBrowser(browser: Browser | null): void {
    this._browserContext.setBrowser(browser);
  }

  getBrowser(): Browser | null {
    return this._browserContext.getBrowser();
  }

  getBrowserTargetInspector(): BrowserTargetInspector {
    this._browserTargetInspector ??= new BrowserTargetInspector(() =>
      this.getBrowser(),
    );
    return this._browserTargetInspector;
  }

  setBrowserManager(browserManager: BrowserManager): void {
    this._browserContext.setBrowserManager(browserManager);
    this._serviceLocator.setBrowserManager(browserManager);
  }

  get collector() {
    return this._serviceLocator.getCollector();
  }

  setContext(context: BrowserContext): void {
    this._browserContext.setContext(context);
    this._collectorContext.start(context);
  }

  clearContext(): void {
    this._browserContext.clearContext();
  }

  getContext(): BrowserContext | null {
    return this._browserContext.getContext();
  }

  getBrowserContext(): BrowserContext | null {
    return this._browserContext.getContext();
  }

  getPersistentHookRegistry(): PersistentHookRegistry {
    return this.hookManager.getPersistentHookRegistry();
  }

  isBrowserConnected(): boolean {
    return this._browserContext.isBrowserConnected();
  }

  async isCollectorRunning(): Promise<boolean> {
    return this._browserContext.getContext() !== null;
  }

  get networkCollector(): NetworkRequestCollector {
    return this._collectorContext.networkCollector;
  }

  get consoleCollector(): ConsoleMessageCollector {
    return this._collectorContext.consoleCollector;
  }

  get wsCollector(): WsCollector {
    return this._collectorContext.wsCollector;
  }

  getSelectedPage(): Page | null {
    return this._browserContext.getSelectedPage();
  }

  setSelectedPage(page: Page | null): void {
    this._browserContext.setSelectedPage(page);
  }

  getSelectedFrame(): Frame | null {
    return this._browserContext.getSelectedFrame();
  }

  setSelectedFrame(frame: Frame | null): void {
    this._browserContext.setSelectedFrame(frame);
  }

  selectFrameByIdx(frameIdx: number): Frame | null {
    return this._browserContext.selectFrameByIdx(frameIdx);
  }

  getPages(): Page[] {
    return this._browserContext.getPages();
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

  async syncPages(): Promise<Page[]> {
    return this._browserContext.syncPages();
  }

  setPages(pages: Page[]): void {
    this._browserContext.setPages(pages);
  }

  getPageByIdx(idx: number): Page {
    return this._browserContext.getPageByIdx(idx);
  }

  getPageId(page: Page): string {
    return this._browserContext.getPageId(page);
  }

  resolvePage(selector: PageSelector): ResolvedPage {
    return this._browserContext.resolvePage(selector);
  }

  getSelectedPageIndex(): number | null {
    return this._browserContext.getSelectedPageIndex();
  }

  async newPage(): Promise<Page> {
    const page = await this._browserContext.newPage();
    if (!this._collectorContext.isStarted()) {
      this._collectorContext.attachPage(page);
    }
    return page;
  }

  selectPage(page: Page): void {
    this._browserContext.selectPage(page);
  }

  async bringPageToFront(page: Page): Promise<void> {
    await this._browserContext.bringPageToFront(page);
  }

  syncPageContext(page: Page): void {
    this._browserContext.syncPageContext(page);
  }

  async getActivePage(): Promise<Page> {
    return this._browserContext.getActivePage();
  }

  async getDebuggerContext(page?: Page): Promise<DebuggerManager> {
    const activePage = page ?? (await this._browserContext.getActivePage());
    return this._debuggerContext.ensureForPage(activePage);
  }

  getExistingDebuggerContext(page?: Page): DebuggerManager | undefined {
    const target = page ?? this.getSelectedPage();
    return target ? this._debuggerContext.getForPage(target) : undefined;
  }

  async disposeDebuggerContext(page?: Page): Promise<void> {
    const activePage = page ?? this._browserContext.getSelectedPage();
    if (!activePage) return;
    await this._debuggerContext.dispose(activePage);
  }

  get deobfuscator() {
    return this._serviceLocator.getDeobfuscator();
  }

  get analyzer() {
    return this._serviceLocator.getAnalyzer();
  }

  get summarizer() {
    return this._serviceLocator.getSummarizer();
  }

  get cryptoDetector() {
    return this._serviceLocator.getCryptoDetector();
  }

  get hookManager() {
    return this._serviceLocator.getHookManager();
  }

  get pageController() {
    return this._serviceLocator.getPageController();
  }

  getDialog(): Dialog | undefined {
    return this._browserContext.getDialog();
  }

  clearDialog(): void {
    this._browserContext.clearDialog();
  }

  setNetworkConditions(conditions: string | null): void {
    this._browserContext.setNetworkConditions(conditions);
  }

  getNetworkConditions(): string | null {
    return this._browserContext.getNetworkConditions();
  }

  setCpuThrottlingRate(rate: number): void {
    this._browserContext.setCpuThrottlingRate(rate);
  }

  getCpuThrottlingRate(): number {
    return this._browserContext.getCpuThrottlingRate();
  }

  private _resolveNetworkPage(pageIdx?: number): Page | null {
    if (typeof pageIdx === 'number') {
      return this._browserContext.getPageByIdx(pageIdx);
    }
    return this._browserContext.getSelectedPage();
  }

  getNetworkRequests(
    includePreservedRequests?: boolean,
    pageIdx?: number,
  ): HTTPRequest[] {
    const page = this._resolveNetworkPage(pageIdx);
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

  getNetworkRequestById(reqid: number): HTTPRequest {
    return this._collectorContext.getNetworkRequestById(
      this._browserContext.getCandidatePages(),
      reqid,
    );
  }

  clearNetworkRequests(pageIdx?: number): void {
    const page = this._resolveNetworkPage(pageIdx);
    this._collectorContext.clearNetworkRequests(page);
  }

  clearNetworkRequestsForPage(page: Page): void {
    this._collectorContext.clearNetworkRequests(page);
  }

  getNetworkRequestStableId(request: unknown): number {
    return this._collectorContext.getNetworkRequestStableId(
      this._browserContext.getCandidatePages(),
      request,
    );
  }

  getRequestInitiator(request: unknown): RequestInitiator | undefined {
    const req = request as {initiator?: () => RequestInitiator};
    if (typeof req.initiator === 'function') {
      return req.initiator();
    }
    return undefined;
  }

  async getDevToolsData(): Promise<undefined> {
    return undefined;
  }

  resolveCdpRequestId(_cdpRequestId: string): undefined {
    return undefined;
  }

  getConsoleData(
    includePreservedMessages?: boolean,
  ): Array<ConsoleMessage | Error> {
    return this._collectorContext.getConsoleData(
      this._browserContext.getSelectedPage(),
      includePreservedMessages,
    );
  }

  getConsoleMessageById(id: number): ConsoleMessage | Error {
    return this._collectorContext.getConsoleMessageById(
      this._browserContext.getSelectedPage(),
      id,
    );
  }

  getConsoleMessageStableId(message: unknown): number {
    return this._collectorContext.getConsoleMessageStableId(
      this._browserContext.getCandidatePages(),
      message,
    );
  }

  getWebSocketConnections(includePreservedData?: boolean): WebSocketData[] {
    return this._collectorContext.getWebSocketConnections(
      this._browserContext.getSelectedPage(),
      includePreservedData,
    );
  }

  getWebSocketConnectionById(wsid: number): WebSocketData {
    return this._collectorContext.getWebSocketConnectionById(
      this._browserContext.getSelectedPage(),
      wsid,
    );
  }

  getWebSocketStableId(ws: unknown): number {
    return this._collectorContext.getWebSocketStableId(
      this._browserContext.getCandidatePages(),
      ws,
    );
  }

  isRunningPerformanceTrace(): boolean {
    return this._isRunningPerformanceTrace;
  }

  setIsRunningPerformanceTrace(running: boolean): void {
    this._isRunningPerformanceTrace = running;
  }

  storeTraceRecording(result: TraceResult): void {
    this._traceRecordings.push(result);
  }

  recordedTraces(): TraceResult[] {
    return this._traceRecordings;
  }
}
