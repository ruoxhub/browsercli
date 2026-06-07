/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolContextProvider — Tool 执行上下文的 Facade
 *
 * 把原单体的职责拆到四个子模块，本类只做转发以保持公共 API 不变：
 *   - BrowserContextProvider   页面/Frame/Dialog/超时与节流
 *   - DebuggerContextProvider  CDP DebuggerContext 的创建与释放
 *   - CollectorContextProvider Network/Console/WebSocket 收集与查询
 *   - ServiceLocator           分析服务的惰性装配
 */

import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Dialog,
  Frame,
  Page,
} from 'patchright';

import type {BrowserManager} from '../browser/index.js';
import type {DebuggerContext} from '../DebuggerContext.js';
import type {Runtime} from '../runtime.js';
import type {HTTPRequest} from '../third_party/index.js';
import type {RequestInitiator} from '../tools/network/types.js';
import type {WebSocketData} from '../tools/network/WebSocketCollector.js';
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
import {ServiceLocator} from './context/ServiceLocator.js';
import type {ToolTabContext} from './ToolCallContextGuard.js';

type TraceResult = unknown;

function ignoreDebuggerWarmupError(): void {
  // CDP warmup is best-effort; the caller can still resolve frames/pages without it.
}

export class ToolContextProvider {
  private readonly _browserContext = new BrowserContextProvider();
  private readonly _debuggerContext = new DebuggerContextProvider();
  private readonly _collectorContext = new CollectorContextProvider();
  private readonly _serviceLocator: ServiceLocator;

  private _isRunningPerformanceTrace = false;
  private _traceRecordings: TraceResult[] = [];
  private _isDisposed = false;
  public readonly eventBus: EventBus<AppEventMap>;

  constructor(runtime?: Runtime) {
    this._serviceLocator = new ServiceLocator(runtime);
    this.eventBus =
      runtime?.eventBus ??
      new EventBus<AppEventMap>(createAppEventBusOptions());
  }

  // ─── 生命周期 ────────────────────────────────────────

  /**
   * 初始化收集器并同步当前页面列表。
   * 应在 BrowserContext 就绪后调用一次。
   */
  async init(): Promise<void> {
    if (this._isDisposed) {
      throw new Error('ToolContextProvider 已销毁，无法重新初始化');
    }
    await this._browserContext.syncPages();

    const context = this._browserContext.getContext();
    if (context) {
      this._collectorContext.start(context);
    }

    // Firefox 通道下，BrowserManager 启动时会主动 newPage() 补一个
    // fallback page（见 BrowserManager.launchBrowser），但该 page 只写入了
    // BrowserManager.currentPage，没有同步给 BrowserContextProvider.selectedPage。
    // 此处兜底：若 syncPages 之后 selectedPage 仍为 null，但 BrowserManager
    // 持有可用 currentPage，则把 currentPage 同步过来，避免 list_pages 等
    // 工具启动后就抛 "没有选中的页面"。
    if (!this._browserContext.getSelectedPage()) {
      const mgr = this._browserContext.getBrowserManager();
      const currentPage = mgr?.getCurrentPage();
      if (currentPage && !currentPage.isClosed()) {
        this._browserContext.setSelectedPage(currentPage);
      }
    }
  }

  /**
   * 释放所有资源、监听器和会话。
   */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    void this._debuggerContext.disposeAll(this._browserContext.getPages());
    this._collectorContext.dispose();
    this._browserContext.dispose();
  }

  // ─── Browser / Context 管理 ──────────────────────────

  setBrowser(browser: Browser): void {
    this._browserContext.setBrowser(browser);
  }

  getBrowser(): Browser | null {
    return this._browserContext.getBrowser();
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
    // BrowserContext 就绪后立刻启动收集器，保证在 init() 之前发生的
    // 页面创建也会被收集到。
    this._collectorContext.start(context);
  }

  getContext(): BrowserContext | null {
    return this._browserContext.getContext();
  }

  isBrowserConnected(): boolean {
    return this._browserContext.isBrowserConnected();
  }

  async isCollectorRunning(): Promise<boolean> {
    return this._browserContext.getContext() !== null;
  }

  // ─── PageCollector 访问（保留旧 API） ─────────────────

  get networkCollector(): NetworkRequestCollector {
    return this._collectorContext.networkCollector;
  }

  get consoleCollector(): ConsoleMessageCollector {
    return this._collectorContext.consoleCollector;
  }

  get wsCollector(): WsCollector {
    return this._collectorContext.wsCollector;
  }

  // ─── 页面/Frame 管理 ─────────────────────────────────

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

  /**
   * 按索引选择 Frame（0 = 主 frame），返回选中的 Frame。
   * 选中后异步触发 DebuggerContext 初始化，与旧行为保持一致。
   */
  selectFrameByIdx(frameIdx: number): Frame | null {
    const frame = this._browserContext.selectFrameByIdx(frameIdx);
    if (frame) {
      const page = this._browserContext.getSelectedPage();
      if (page) {
        void this._debuggerContext
          .ensureForPage(page)
          .catch(ignoreDebuggerWarmupError);
      }
    }
    return frame;
  }

  getPages(): Page[] {
    return this._browserContext.getPages();
  }

  getContextMeta(): ToolTabContext {
    const page = this.getSelectedPage();
    const pages = this.getPages();
    const tabIndex = page ? pages.indexOf(page) : null;
    return {
      url: page?.url() ?? null,
      title: null,
      tabIndex,
      pageId: tabIndex === null || tabIndex < 0 ? null : String(tabIndex),
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

  async newPage(): Promise<Page> {
    const page = await this._browserContext.newPage();
    // BrowserContext 级监听器已经会自动注册新页面，但如果 context 收集尚未启动
    // （例如 setContext 之前调用了 newPage，理论上不会发生但保守处理），补一刀。
    if (!this._collectorContext.isStarted()) {
      this._collectorContext.attachPage(page);
    }
    return page;
  }

  selectPage(page: Page): void {
    this._browserContext.selectPage(page);
    // 页面切换后重新初始化 debugger，与旧实现一致
    void this._debuggerContext
      .ensureForPage(page)
      .catch(ignoreDebuggerWarmupError);
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

  // ─── Debugger 管理 ───────────────────────────────────

  async getDebuggerContext(page?: Page): Promise<DebuggerContext> {
    const activePage = page ?? (await this._browserContext.getActivePage());
    return this._debuggerContext.ensureForPage(activePage);
  }

  async disposeDebuggerContext(page?: Page): Promise<void> {
    const activePage = page ?? this._browserContext.getSelectedPage();
    if (!activePage) return;
    await this._debuggerContext.dispose(activePage);
  }

  // ─── 分析服务（ServiceLocator 代理）──────────────────

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

  // ─── Dialog ─────────────────────────────────────────

  getDialog(): Dialog | undefined {
    return this._browserContext.getDialog();
  }

  clearDialog(): void {
    this._browserContext.clearDialog();
  }

  // ─── 网络/CPU 节流 ───────────────────────────────────

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

  // ─── Network 数据查询 ────────────────────────────────

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

  getNetworkRequestById(reqid: number): HTTPRequest {
    return this._collectorContext.getNetworkRequestById(
      this._browserContext.getCandidatePages(),
      reqid,
    );
  }

  getNetworkRequestStableId(request: unknown): number {
    return this._collectorContext.getNetworkRequestStableId(
      this._browserContext.getCandidatePages(),
      request,
    );
  }

  getRequestInitiator(request: unknown): RequestInitiator | undefined {
    // Playwright 的 Request 对象有 initiator() 方法
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

  // ─── Console 数据查询 ────────────────────────────────

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

  // ─── WebSocket 数据查询 ──────────────────────────────

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

  // ─── 性能 Trace ──────────────────────────────────────

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
