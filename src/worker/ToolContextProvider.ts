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

import type {
  Browser,
  BrowserContext,
  CDPSession,
  Frame,
  Page,
  Request,
} from 'patchright';

import {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import {CryptoDetector} from '../modules/crypto/CryptoDetector.js';
import {Deobfuscator} from '../modules/deobfuscator/Deobfuscator.js';
import {LLMService} from '../services/LLMService.js';
import type {HTTPRequest} from '../third_party/index.js';
import type {RequestInitiator} from '../tools/network/types.js';
import {BrowserManager} from '../browser/index.js';
import {CodeCollector} from '../modules/collector/CodeCollector.js';
import {DebuggerContext} from '../utils/DebuggerContext.js';

type TraceResult = unknown;

/**
 * 带稳定 ID 的请求记录
 */
interface TrackedRequest {
  stableId: number;
  request: Request;
  initiator?: RequestInitiator;
}

/**
 * 单个 Page 的导航分组存储
 * navigations[0] 为当前导航，后续为保留的历史导航
 */
type PageRequestStorage = TrackedRequest[][];

export class ToolContextProvider {
  private selectedPage: Page | null = null;
  private selectedFrame: Frame | null = null;
  private pagesList: Page[] = [];
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _isRunningPerformanceTrace = false;
  private _traceRecordings: TraceResult[] = [];
  private _llmService: LLMService | null = null;
  private _deobfuscator: Deobfuscator | null = null;
  private _analyzer: CodeAnalyzer | null = null;
  private _summarizer: AISummarizer | null = null;
  private _cryptoDetector: CryptoDetector | null = null;
  private _debuggerContexts = new WeakMap<Page, DebuggerContext>();
  private _debuggerSessions = new WeakMap<Page, CDPSession>();
  private _browserManager: BrowserManager | null = null;
  private _collector: CodeCollector | null = null;

  // ─── 网络请求收集 ────────────────────────────────────
  private _networkStorage = new WeakMap<Page, PageRequestStorage>();
  private _idGenerators = new WeakMap<Page, () => number>();
  private _maxNavigationSaved = 3;
  private _pageListeners = new WeakMap<
    Page,
    {onRequest: (req: Request) => void; onFrameNavigated: () => void}
  >();
  private _contextListener: {onPage: (page: Page) => void} | null = null;

  // ─── Browser / Context 管理 ──────────────────────────

  setBrowser(browser: Browser): void {
    this._browser = browser;
  }

  getBrowser(): Browser | null {
    return this._browser;
  }

  setBrowserManager(browserManager: BrowserManager): void {
    this._browserManager = browserManager;
  }

  get collector(): CodeCollector {
    if (!this._collector) {
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
    }
    return this._collector;
  }

  setContext(context: BrowserContext): void {
    this._context = context;
    this._startNetworkCollection(context);
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
    // 页面切换时重置 frame 选择，回退到主 frame
    this.selectedFrame = page?.mainFrame() ?? null;
  }

  // ─── Frame 管理 ───────────────────────────────────────

  getSelectedFrame(): Frame | null {
    return this.selectedFrame;
  }

  setSelectedFrame(frame: Frame | null): void {
    this.selectedFrame = frame;
  }

  /** 按索引选择 Frame（0 = 主 frame），返回选中的 Frame */
  selectFrameByIdx(frameIdx: number): Frame | null {
    const page = this.selectedPage;
    if (!page) return null;
    const frames = page.frames();
    if (frameIdx < 0 || frameIdx >= frames.length) return null;
    this.selectedFrame = frames[frameIdx]!;
    return this.selectedFrame;
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
    if (!page)
      throw new Error(`页面索引 ${idx} 超出范围 (共 ${pages.length} 个页面)`);
    return page;
  }

  async newPage(): Promise<Page> {
    if (!this._context) throw new Error('BrowserContext 未初始化');
    const page = await this._context.newPage();
    this.pagesList = this._context.pages();
    return page;
  }

  selectPage(page: Page): void {
    this.setSelectedPage(page);
  }

  async getDebuggerContext(page?: Page): Promise<DebuggerContext> {
    const activePage = page ?? (await this.getActivePage());
    const existing = this._debuggerContexts.get(activePage);
    if (existing?.isEnabled()) {
      return existing;
    }

    const client = await activePage.context().newCDPSession(activePage);
    const debuggerContext = new DebuggerContext();
    await debuggerContext.enable(client);

    this._debuggerContexts.set(activePage, debuggerContext);
    this._debuggerSessions.set(activePage, client);

    activePage.once('close', () => {
      void this.disposeDebuggerContext(activePage);
    });

    return debuggerContext;
  }

  async disposeDebuggerContext(page?: Page): Promise<void> {
    const activePage = page ?? this.selectedPage;
    if (!activePage) {
      return;
    }

    const debuggerContext = this._debuggerContexts.get(activePage);
    if (debuggerContext) {
      try {
        await debuggerContext.disable();
      } catch {
        // Ignore cleanup errors when the page/session is already gone.
      }
    }

    const client = this._debuggerSessions.get(activePage);
    if (client) {
      try {
        await client.detach();
      } catch {
        // Ignore cleanup errors when the page/session is already gone.
      }
    }
  }

  async bringPageToFront(page: Page): Promise<void> {
    await page.bringToFront();
  }

  syncPageContext(page: Page): void {
    this.setSelectedPage(page);
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

  // ─── AnalyzerRuntimeServices ───────────────────────────

  get deobfuscator(): Deobfuscator {
    if (!this._deobfuscator) {
      this._deobfuscator = new Deobfuscator(this._getLlmService());
    }
    return this._deobfuscator;
  }

  get analyzer(): CodeAnalyzer {
    if (!this._analyzer) {
      this._analyzer = new CodeAnalyzer(this._getLlmService());
    }
    return this._analyzer;
  }

  get summarizer(): AISummarizer {
    if (!this._summarizer) {
      this._summarizer = new AISummarizer(this._getLlmService());
    }
    return this._summarizer;
  }

  get cryptoDetector(): CryptoDetector {
    if (!this._cryptoDetector) {
      this._cryptoDetector = new CryptoDetector(this._getLlmService());
    }
    return this._cryptoDetector;
  }

  isBrowserConnected(): boolean {
    return this._browser?.isConnected() ?? false;
  }

  async isCollectorRunning(): Promise<boolean> {
    return !!this._context;
  }

  // ─── 网络请求收集（Playwright 原生实现） ──────────────

  /**
   * 启动网络请求收集：监听 BrowserContext 的 page 和 request 事件
   */
  private _startNetworkCollection(context: BrowserContext): void {
    // 为 context 中已有页面注册收集
    for (const page of context.pages()) {
      this._attachPageListeners(page);
    }

    // 监听新页面创建
    const onPage = (page: Page) => {
      this._attachPageListeners(page);
    };
    this._contextListener = {onPage};
    context.on('page', onPage);
  }

  /**
   * 为单个 Page 注册 request 和 framenavigated 监听
   */
  private _attachPageListeners(page: Page): void {
    if (this._networkStorage.has(page)) {
      return;
    }

    // 初始化存储和 ID 生成器
    const idGenerator = this._createIdGenerator();
    this._idGenerators.set(page, idGenerator);
    const storage: PageRequestStorage = [[]];
    this._networkStorage.set(page, storage);

    // 监听请求
    const onRequest = (req: Request): void => {
      const navigations = this._networkStorage.get(page);
      if (!navigations) return;
      const tracked: TrackedRequest = {
        stableId: idGenerator(),
        request: req,
      };
      navigations[0]!.push(tracked);
    };
    page.on('request', onRequest);

    // 主 frame 导航时分割存储
    const onFrameNavigated = (): void => {
      this._splitAfterNavigation(page);
    };
    page.on('framenavigated', (frame: Frame) => {
      if (frame === page.mainFrame()) {
        onFrameNavigated();
      }
    });

    this._pageListeners.set(page, {onRequest, onFrameNavigated});

    // 页面关闭时清理
    page.once('close', () => {
      this._detachPageListeners(page);
    });
  }

  /**
   * 清理 Page 的监听和存储
   */
  private _detachPageListeners(page: Page): void {
    const listeners = this._pageListeners.get(page);
    if (listeners) {
      try {
        page.off('request', listeners.onRequest);
      } catch {
        // Page might already be closed
      }
    }
    this._pageListeners.delete(page);
    this._networkStorage.delete(page);
    this._idGenerators.delete(page);
  }

  /**
   * 主 frame 导航后分割请求存储
   *
   * 找到最后一个导航请求（主 frame 的 document 类型请求），
   * 将该请求及其之后的所有请求移到新导航组，
   * 确保导航请求不会丢失在历史导航中。
   */
  private _splitAfterNavigation(page: Page): void {
    const navigations = this._networkStorage.get(page);
    if (!navigations) return;

    const requests = navigations[0]!;

    // 找到最后一个属于主 frame 的导航请求（resourceType === 'document'）
    const lastNavIdx = requests.findLastIndex(tracked => {
      const req = tracked.request;
      return (
        req.frame() === page.mainFrame() && req.resourceType() === 'document'
      );
    });

    if (lastNavIdx !== -1) {
      // 保留导航请求及其之后的所有请求到新导航组
      const fromCurrentNavigation = requests.splice(lastNavIdx);
      navigations.unshift(fromCurrentNavigation);
    } else {
      navigations.unshift([]);
    }

    navigations.splice(this._maxNavigationSaved);
  }

  private _createIdGenerator(): () => number {
    let i = 1;
    return () => {
      if (i === Number.MAX_SAFE_INTEGER) {
        i = 0;
      }
      return i++;
    };
  }

  // ─── NetworkRuntimeServices ───────────────────────────

  private _resolveNetworkPage(pageIdx?: number): Page | null {
    if (typeof pageIdx === 'number') {
      return this.getPageByIdx(pageIdx);
    }
    return this.selectedPage;
  }

  private _getNetworkCandidatePages(): Page[] {
    return this.selectedPage
      ? [
          this.selectedPage,
          ...this.getPages().filter(page => page !== this.selectedPage),
        ]
      : this.getPages();
  }

  getNetworkRequests(
    includePreservedRequests?: boolean,
    pageIdx?: number,
  ): HTTPRequest[] {
    const page = this._resolveNetworkPage(pageIdx);
    if (!page) return [];

    const navigations = this._networkStorage.get(page);
    if (!navigations) return [];

    if (!includePreservedRequests) {
      return navigations[0]!.map(t => t.request as unknown as HTTPRequest);
    }

    const requests: HTTPRequest[] = [];
    for (let index = this._maxNavigationSaved; index >= 0; index--) {
      if (navigations[index]) {
        requests.push(
          ...navigations[index]!.map(t => t.request as unknown as HTTPRequest),
        );
      }
    }
    return requests;
  }

  getNetworkRequestById(reqid: number): HTTPRequest {
    const candidatePages = this._getNetworkCandidatePages();
    if (candidatePages.length === 0) {
      throw new Error('未选中页面');
    }

    for (const page of candidatePages) {
      const navigations = this._networkStorage.get(page);
      if (!navigations) {
        continue;
      }

      for (const navigation of navigations) {
        const found = navigation.find(t => t.stableId === reqid);
        if (found) {
          return found.request as unknown as HTTPRequest;
        }
      }
    }

    throw new Error(`请求 ID ${reqid} 未找到`);
  }

  getNetworkRequestStableId(request: unknown): number {
    const candidatePages = this._getNetworkCandidatePages();

    for (const page of candidatePages) {
      const navigations = this._networkStorage.get(page);
      if (!navigations) {
        continue;
      }

      for (const navigation of navigations) {
        const found = navigation.find(t => t.request === (request as Request));
        if (found) return found.stableId;
      }
    }

    return -1;
  }

  getRequestInitiator(request: unknown): RequestInitiator | undefined {
    // Playwright 的 Request 对象有 initiator() 方法
    const req = request as Request;
    // @ts-expect-error initiator() may not be on the public Playwright type
    if (typeof req.initiator === 'function') {
      // @ts-expect-error Playwright internal
      return req.initiator() as RequestInitiator;
    }
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

  // ─── WebSocketRuntimeServices (stub) ──────────────────

  getWebSocketConnections(): unknown[] {
    return [];
  }

  getWebSocketConnectionById(_wsid: number): unknown {
    return undefined;
  }

  // ─── PerformanceRuntimeServices ────────────────────────

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

  private _getLlmService(): LLMService {
    if (!this._llmService) {
      this._llmService = new LLMService();
    }
    return this._llmService;
  }
}
