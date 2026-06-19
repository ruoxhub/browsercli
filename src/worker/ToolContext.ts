/**
 * @license
 * Copyright 2026 JSReverser-MCP
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

import type {BrowserManager} from '../browser/index.js';
import type {DebuggerContext} from '../DebuggerContext.js';
import type {TrafficSummary} from '../formatters/websocketFormatter.js';
import type {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {AISummarizer as FallbackAISummarizer} from '../modules/analyzer/AISummarizer.js';
import type {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import {CodeAnalyzer as FallbackCodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import {CodeCollector} from '../modules/collector/CodeCollector.js';
import {PageController} from '../modules/collector/PageController.js';
import {CryptoDetector} from '../modules/crypto/CryptoDetector.js';
import {Deobfuscator} from '../modules/deobfuscator/Deobfuscator.js';
import {HookManager} from '../modules/hook/HookManager.js';
import type {Runtime} from '../runtime.js';
import {LLMService} from '../services/LLMService.js';
import type {HTTPRequest} from '../third_party/index.js';
import type {RequestInitiator} from '../tools/network/types.js';
import type {WebSocketData} from '../tools/network/WebSocketCollector.js';
import type {Context} from '../tools/ToolDefinition.js';
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
import type {ToolTabContext} from './ToolCallContextGuard.js';
import {wrapFrameWithTimeout} from './timeoutUtils.js';

export class ServiceLocator {
  private _runtime: Runtime | null = null;

  private _browserManager: BrowserManager | null = null;
  private _collector: CodeCollector | null = null;
  private _llmService: LLMService | null = null;
  private _deobfuscator: Deobfuscator | null = null;
  private _analyzer: CodeAnalyzer | null = null;
  private _summarizer: AISummarizer | null = null;
  private _cryptoDetector: CryptoDetector | null = null;
  private _hookManager: HookManager | null = null;
  private _pageController: PageController | null = null;

  constructor(runtime?: Runtime) {
    if (runtime) {
      this._runtime = runtime;
      this._browserManager = runtime.browserManager;
      this._collector = runtime.collector;
    }
  }

  setBrowserManager(browserManager: BrowserManager): void {
    this._browserManager = browserManager;
  }

  getBrowserManager(): BrowserManager | null {
    return this._browserManager;
  }

  private getOrCreate<T>(
    cached: T | null,
    runtimeKey: keyof Runtime,
    factory: () => T,
  ): T {
    const fromRuntime = this._runtime?.[runtimeKey] as T | undefined;
    if (fromRuntime) return fromRuntime;
    return cached ?? factory();
  }

  getCollector(): CodeCollector {
    if (this._collector) return this._collector;
    if (!this._browserManager) {
      throw new Error(
        'BrowserManager 未初始化，无法创建 CodeCollector。请先调用 setBrowserManager()。',
      );
    }
    const config = {
      timeout: 30000,
      maxCollectedUrls: 10000,
      maxFilesPerCollect: 200,
      maxTotalContentSize: 512 * 1024,
      maxSingleFileSize: 200 * 1024,
    };
    this._collector = new CodeCollector(config, this._browserManager);
    return this._collector;
  }

  getLlmService(): LLMService {
    return this.getOrCreate(this._llmService, 'llmService', () => {
      this._llmService = new LLMService();
      return this._llmService;
    });
  }

  getDeobfuscator(): Deobfuscator {
    return this.getOrCreate(this._deobfuscator, 'deobfuscator', () => {
      this._deobfuscator = new Deobfuscator(this.getLlmService());
      return this._deobfuscator;
    });
  }

  getAnalyzer(): CodeAnalyzer {
    return this.getOrCreate(this._analyzer, 'analyzer', () => {
      this._analyzer = new FallbackCodeAnalyzer(this.getLlmService());
      return this._analyzer;
    });
  }

  getSummarizer(): AISummarizer {
    return this.getOrCreate(this._summarizer, 'summarizer', () => {
      this._summarizer = new FallbackAISummarizer(this.getLlmService());
      return this._summarizer;
    });
  }

  getCryptoDetector(): CryptoDetector {
    return this.getOrCreate(this._cryptoDetector, 'cryptoDetector', () => {
      this._cryptoDetector = new CryptoDetector(this.getLlmService());
      return this._cryptoDetector;
    });
  }

  getHookManager(): HookManager {
    return this.getOrCreate(this._hookManager, 'hookManager', () => {
      this._hookManager = new HookManager();
      return this._hookManager;
    });
  }

  getPageController(): PageController {
    return this.getOrCreate(this._pageController, 'pageController', () => {
      this._pageController = new PageController(this.getCollector());
      return this._pageController;
    });
  }
}

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

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    void this._debuggerContext.disposeAll(this._browserContext.getPages());
    this._collectorContext.dispose();
    this._browserContext.dispose();
  }

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
    if (!this._collectorContext.isStarted()) {
      this._collectorContext.attachPage(page);
    }
    return page;
  }

  selectPage(page: Page): void {
    this._browserContext.selectPage(page);
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

  async getDebuggerContext(page?: Page): Promise<DebuggerContext> {
    const activePage = page ?? (await this._browserContext.getActivePage());
    return this._debuggerContext.ensureForPage(activePage);
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

export class DefineToolContextFactory {
  private readonly trafficSummaryCache = new Map<number, TrafficSummary>();

  constructor(private readonly provider: ToolContextProvider) {}

  create(): Context {
    const provider = this.provider;
    return {
      isRunningPerformanceTrace: () => provider.isRunningPerformanceTrace(),
      setIsRunningPerformanceTrace: (x: boolean) =>
        provider.setIsRunningPerformanceTrace(x),
      recordedTraces: () => provider.recordedTraces() as TraceResult[],
      storeTraceRecording: (result: TraceResult) =>
        provider.storeTraceRecording(result),
      getSelectedPage: () => {
        const page = provider.getSelectedPage();
        if (!page) throw new Error('没有选中的页面');
        return page;
      },
      getDialog: () => provider.getDialog(),
      clearDialog: () => provider.clearDialog(),
      getPageByIdx: idx => provider.getPageByIdx(idx),
      isPageSelected: page => provider.getSelectedPage() === page,
      newPage: () => provider.newPage(),
      closePage: async (pageIdx: number) => {
        const page = provider.getPageByIdx(pageIdx);
        await page.close();
        await provider.syncPages();
      },
      selectPage: page => provider.selectPage(page),
      bringPageToFront: page => provider.bringPageToFront(page),
      syncPageContext: page => provider.syncPageContext(page),
      getPages: () => provider.getPages(),
      getSelectedFrame: () => {
        const frame =
          provider.getSelectedFrame() ??
          provider.getSelectedPage()?.mainFrame();
        if (!frame) {
          throw new Error('没有可用的 Frame，可能页面未选中或已关闭');
        }
        return wrapFrameWithTimeout(frame);
      },
      selectFrame: frame => provider.setSelectedFrame(frame),
      resetSelectedFrame: () => provider.setSelectedFrame(null),
      setNetworkConditions: conditions =>
        provider.setNetworkConditions(conditions),
      setCpuThrottlingRate: rate => provider.setCpuThrottlingRate(rate),
      saveTemporaryFile: async (_data, _mimeType) => {
        throw new Error('saveTemporaryFile not supported in worker mode');
      },
      saveFile: async (_data, _filename) => {
        throw new Error('saveFile not supported in worker mode');
      },
      waitForEventsAfterAction: async action => {
        await action();
      },
      waitForTextOnPage: async _params => {
        throw new Error('waitForTextOnPage not supported in worker mode');
      },
      getDevToolsData: () => provider.getDevToolsData(),
      resolveCdpRequestId: cdpRequestId =>
        provider.resolveCdpRequestId(cdpRequestId),
      getDebuggerContext: () => provider.getDebuggerContext(),
      getRequestInitiator: request => provider.getRequestInitiator(request),
      getRequestInitiatorById: _requestId => undefined,
      getNetworkRequestById: reqid => provider.getNetworkRequestById(reqid),
      getWebSocketConnections: includePreservedData =>
        provider.getWebSocketConnections(includePreservedData),
      getWebSocketById: wsid => provider.getWebSocketConnectionById(wsid),
      getWebSocketStableId: ws => provider.getWebSocketStableId(ws),
      cacheTrafficSummary: (wsid, summary) => {
        this.trafficSummaryCache.set(wsid, summary);
      },
      getCachedTrafficSummary: wsid => this.trafficSummaryCache.get(wsid),
    };
  }
}
