/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolContextProvider — Tool 执行上下文的 Facade
 *
 * 本类拆分为四个单一职责的子模块，各自承担原本散落在这里的逻辑：
 *   - PageManager            页面/Frame/Dialog/超时与网络 CPU 节流
 *   - DebuggerSessionManager CDP DebuggerContext 的创建与释放
 *   - DataCollectorManager   Network/Console/WebSocket 收集与查询
 *   - ServiceLocator         Deobfuscator/CodeAnalyzer/AISummarizer 等
 *                            分析服务的惰性装配
 *
 * 本文件保留所有既有公开方法签名，调用转发给对应子模块，
 * 以避免破坏 ToolAdapter、Runtime、各 Tool handler 等现有消费者。
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
import {DataCollectorManager} from './context/DataCollectorManager.js';
import {DebuggerSessionManager} from './context/DebuggerSessionManager.js';
import {PageManager} from './context/PageManager.js';
import {ServiceLocator} from './context/ServiceLocator.js';
import type {ToolTabContext} from './ToolCallContextGuard.js';

type TraceResult = unknown;

function ignoreDebuggerWarmupError(): void {
  // DebuggerContext warmup is opportunistic; callers still resolve frames/pages
  // through the selected Page if a CDP session cannot be established yet.
}

export class ToolContextProvider {
  private readonly _pageManager = new PageManager();
  private readonly _debuggerManager = new DebuggerSessionManager();
  private readonly _dataCollectorManager = new DataCollectorManager();
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
    await this._pageManager.syncPages();

    const context = this._pageManager.getContext();
    if (context) {
      this._dataCollectorManager.start(context);
    }
  }

  /**
   * 释放所有资源、监听器和会话。
   */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    void this._debuggerManager.disposeAll(this._pageManager.getPages());
    this._dataCollectorManager.dispose();
    this._pageManager.dispose();
  }

  // ─── Browser / Context 管理 ──────────────────────────

  setBrowser(browser: Browser): void {
    this._pageManager.setBrowser(browser);
  }

  getBrowser(): Browser | null {
    return this._pageManager.getBrowser();
  }

  setBrowserManager(browserManager: BrowserManager): void {
    this._pageManager.setBrowserManager(browserManager);
    this._serviceLocator.setBrowserManager(browserManager);
  }

  get collector() {
    return this._serviceLocator.getCollector();
  }

  setContext(context: BrowserContext): void {
    this._pageManager.setContext(context);
    // BrowserContext 就绪后立刻启动收集器，保证在 init() 之前发生的
    // 页面创建也会被收集到。
    this._dataCollectorManager.start(context);
  }

  getContext(): BrowserContext | null {
    return this._pageManager.getContext();
  }

  isBrowserConnected(): boolean {
    return this._pageManager.isBrowserConnected();
  }

  async isCollectorRunning(): Promise<boolean> {
    return this._pageManager.getContext() !== null;
  }

  // ─── PageCollector 访问（保留旧 API） ─────────────────

  get networkCollector(): NetworkRequestCollector {
    return this._dataCollectorManager.networkCollector;
  }

  get consoleCollector(): ConsoleMessageCollector {
    return this._dataCollectorManager.consoleCollector;
  }

  get wsCollector(): WsCollector {
    return this._dataCollectorManager.wsCollector;
  }

  // ─── 页面/Frame 管理 ─────────────────────────────────

  getSelectedPage(): Page | null {
    return this._pageManager.getSelectedPage();
  }

  setSelectedPage(page: Page | null): void {
    this._pageManager.setSelectedPage(page);
  }

  getSelectedFrame(): Frame | null {
    return this._pageManager.getSelectedFrame();
  }

  setSelectedFrame(frame: Frame | null): void {
    this._pageManager.setSelectedFrame(frame);
  }

  /**
   * 按索引选择 Frame（0 = 主 frame），返回选中的 Frame。
   * 选中后异步触发 DebuggerContext 初始化，与旧行为保持一致。
   */
  selectFrameByIdx(frameIdx: number): Frame | null {
    const frame = this._pageManager.selectFrameByIdx(frameIdx);
    if (frame) {
      const page = this._pageManager.getSelectedPage();
      if (page) {
        void this._debuggerManager
          .ensureForPage(page)
          .catch(ignoreDebuggerWarmupError);
      }
    }
    return frame;
  }

  getPages(): Page[] {
    return this._pageManager.getPages();
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
    return this._pageManager.syncPages();
  }

  setPages(pages: Page[]): void {
    this._pageManager.setPages(pages);
  }

  getPageByIdx(idx: number): Page {
    return this._pageManager.getPageByIdx(idx);
  }

  async newPage(): Promise<Page> {
    const page = await this._pageManager.newPage();
    // BrowserContext 级监听器已经会自动注册新页面，但如果 context 收集尚未启动
    // （例如 setContext 之前调用了 newPage，理论上不会发生但保守处理），补一刀。
    if (!this._dataCollectorManager.isStarted()) {
      this._dataCollectorManager.attachPage(page);
    }
    return page;
  }

  selectPage(page: Page): void {
    this._pageManager.selectPage(page);
    // 页面切换后重新初始化 debugger，与旧实现一致
    void this._debuggerManager
      .ensureForPage(page)
      .catch(ignoreDebuggerWarmupError);
  }

  async bringPageToFront(page: Page): Promise<void> {
    await this._pageManager.bringPageToFront(page);
  }

  syncPageContext(page: Page): void {
    this._pageManager.syncPageContext(page);
  }

  async getActivePage(): Promise<Page> {
    return this._pageManager.getActivePage();
  }

  // ─── Debugger 管理 ───────────────────────────────────

  async getDebuggerContext(page?: Page): Promise<DebuggerContext> {
    const activePage = page ?? (await this._pageManager.getActivePage());
    return this._debuggerManager.ensureForPage(activePage);
  }

  async disposeDebuggerContext(page?: Page): Promise<void> {
    const activePage = page ?? this._pageManager.getSelectedPage();
    if (!activePage) return;
    await this._debuggerManager.dispose(activePage);
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
    return this._pageManager.getDialog();
  }

  clearDialog(): void {
    this._pageManager.clearDialog();
  }

  // ─── 网络/CPU 节流 ───────────────────────────────────

  setNetworkConditions(conditions: string | null): void {
    this._pageManager.setNetworkConditions(conditions);
  }

  getNetworkConditions(): string | null {
    return this._pageManager.getNetworkConditions();
  }

  setCpuThrottlingRate(rate: number): void {
    this._pageManager.setCpuThrottlingRate(rate);
  }

  getCpuThrottlingRate(): number {
    return this._pageManager.getCpuThrottlingRate();
  }

  // ─── Network 数据查询 ────────────────────────────────

  private _resolveNetworkPage(pageIdx?: number): Page | null {
    if (typeof pageIdx === 'number') {
      return this._pageManager.getPageByIdx(pageIdx);
    }
    return this._pageManager.getSelectedPage();
  }

  getNetworkRequests(
    includePreservedRequests?: boolean,
    pageIdx?: number,
  ): HTTPRequest[] {
    const page = this._resolveNetworkPage(pageIdx);
    return this._dataCollectorManager.getNetworkRequests(
      page,
      includePreservedRequests,
    );
  }

  getNetworkRequestById(reqid: number): HTTPRequest {
    return this._dataCollectorManager.getNetworkRequestById(
      this._pageManager.getCandidatePages(),
      reqid,
    );
  }

  getNetworkRequestStableId(request: unknown): number {
    return this._dataCollectorManager.getNetworkRequestStableId(
      this._pageManager.getCandidatePages(),
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
    return this._dataCollectorManager.getConsoleData(
      this._pageManager.getSelectedPage(),
      includePreservedMessages,
    );
  }

  getConsoleMessageById(id: number): ConsoleMessage | Error {
    return this._dataCollectorManager.getConsoleMessageById(
      this._pageManager.getSelectedPage(),
      id,
    );
  }

  getConsoleMessageStableId(message: unknown): number {
    return this._dataCollectorManager.getConsoleMessageStableId(
      this._pageManager.getCandidatePages(),
      message,
    );
  }

  // ─── WebSocket 数据查询 ──────────────────────────────

  getWebSocketConnections(includePreservedData?: boolean): WebSocketData[] {
    return this._dataCollectorManager.getWebSocketConnections(
      this._pageManager.getSelectedPage(),
      includePreservedData,
    );
  }

  getWebSocketConnectionById(wsid: number): WebSocketData {
    return this._dataCollectorManager.getWebSocketConnectionById(
      this._pageManager.getSelectedPage(),
      wsid,
    );
  }

  getWebSocketStableId(ws: unknown): number {
    return this._dataCollectorManager.getWebSocketStableId(
      this._pageManager.getCandidatePages(),
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
