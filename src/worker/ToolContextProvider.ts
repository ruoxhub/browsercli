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
 *
 * 设计参考 McpContext：所有上下文状态（Browser、Page、Network、Debugger
 * 以及各分析/Hook/Wasm 模块）统一聚合到本类，避免在 runtime.ts
 * 与 Worker 入口之间重复创建服务实例。
 */

import type {
  Browser,
  BrowserContext,
  CDPSession,
  ConsoleMessage,
  Dialog,
  Frame,
  Page,
  Request,
  WebSocket as PlaywrightWebSocket,
} from 'patchright';

import type {BrowserManager} from '../browser/index.js';
import {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
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
import {DebuggerContext} from '../DebuggerContext.js';
import {
  NetworkRequestCollector,
  ConsoleMessageCollector,
  WsCollector,
  type TrackedRequest,
  type TrackedConsoleMessage,
  type TrackedWebSocketData,
} from './collectors.js';

type TraceResult = unknown;

/**
 * 单个 Page 的导航分组存储
 * navigations[0] 为当前导航，后续为保留的历史导航
 */
type PageRequestStorage = TrackedRequest[][];
type PageConsoleStorage = TrackedConsoleMessage[][];
type PageWebSocketStorage = TrackedWebSocketData[][];

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

export class ToolContextProvider {
  private selectedPage: Page | null = null;
  private selectedFrame: Frame | null = null;
  private pagesList: Page[] = [];
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _isRunningPerformanceTrace = false;
  private _traceRecordings: TraceResult[] = [];
  private _debuggerContexts = new WeakMap<Page, DebuggerContext>();
  private _debuggerSessions = new WeakMap<Page, CDPSession>();
  private _browserManager: BrowserManager | null = null;
  private _collector: CodeCollector | null = null;

  /**
   * 聚合的 Runtime 实例。若传入，则所有分析/Hook/Wasm 服务均从 Runtime
   * 复用，避免重复创建。
   */
  private _runtime: Runtime | null = null;

  private _isDisposed = false;

  // ─── 网络请求收集 ────────────────────────────────────
  private _networkStorage = new WeakMap<Page, PageRequestStorage>();
  private _idGenerators = new WeakMap<Page, () => number>();
  private _maxNavigationSaved = 3;
  private _pageListeners = new WeakMap<
    Page,
    {onRequest: (req: Request) => void; onFrameNavigated: () => void}
  >();
  private _contextListener: {onPage: (page: Page) => void} | null = null;

  // ─── Console 收集 ────────────────────────────────────
  private _consoleStorage = new WeakMap<Page, PageConsoleStorage>();
  private _consoleIdGenerators = new WeakMap<Page, () => number>();
  private _consoleListeners = new WeakMap<
    Page,
    {
      onConsole: (msg: ConsoleMessage) => void;
      onPageError: (err: Error) => void;
    }
  >();

  // ─── WebSocket 收集 ─────────────────────────────────
  private _webSocketStorage = new WeakMap<Page, PageWebSocketStorage>();
  private _webSocketIdGenerators = new WeakMap<Page, () => number>();
  private _webSocketConnectionMaps = new WeakMap<
    Page,
    Map<string, TrackedWebSocketData>
  >();
  private _webSocketListeners = new WeakMap<
    Page,
    {
      onWebSocket: (ws: PlaywrightWebSocket) => void;
      onFrameNavigated: (frame: Frame) => void;
    }
  >();
  private _webSocketRequestIdCounters = new WeakMap<Page, number>();

  // ─── PageCollector 实例（新架构，逐步替代上面的内联收集） ──
  private _networkCollector: NetworkRequestCollector | null = null;
  private _consoleCollector: ConsoleMessageCollector | null = null;
  private _wsCollector: WsCollector | null = null;

  // ─── Dialog / 超时 / 条件 ────────────────────────────
  private _dialog?: Dialog;
  private _networkConditionsMap = new WeakMap<Page, string>();
  private _cpuThrottlingRateMap = new WeakMap<Page, number>();

  constructor(runtime?: Runtime) {
    if (runtime) {
      this._runtime = runtime;
      this._browserManager = runtime.browserManager;
      this._collector = runtime.collector;
    }
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
    await this.syncPages();

    // 创建 PageCollector 实例并启动上下文收集
    this._networkCollector = new NetworkRequestCollector();
    this._consoleCollector = new ConsoleMessageCollector();
    this._wsCollector = new WsCollector();

    if (this._context) {
      this._networkCollector.startContextCollection(this._context);
      this._consoleCollector.startContextCollection(this._context);
      this._wsCollector.startContextCollection(this._context);
    }

    // 兼容：保留内联收集逻辑（后续逐步移除）
    for (const page of this.pagesList) {
      if (!this._networkStorage.has(page)) {
        this._attachPageListeners(page);
      }
      this._attachConsoleListeners(page);
      this._attachWebSocketListeners(page);
    }
  }

  /**
   * 释放所有资源、监听器和会话。
   */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    // 清理 debugger
    for (const page of this.pagesList) {
      void this.disposeDebuggerContext(page);
    }

    // 清理 context 级别监听
    if (this._contextListener && this._context) {
      this._context.off('page', this._contextListener.onPage);
    }
    this._contextListener = null;

    // 清理页面级别监听
    for (const page of this.pagesList) {
      this._detachPageListeners(page);
      this._detachConsoleListeners(page);
      this._detachWebSocketListeners(page);
    }

    // 清理 dialog
    if (this.selectedPage) {
      try {
        this.selectedPage.off('dialog', this._dialogHandler);
      } catch {
        // ignore
      }
    }

    this._networkStorage = new WeakMap();
    this._consoleStorage = new WeakMap();
    this._webSocketStorage = new WeakMap();
    this._networkConditionsMap = new WeakMap();
    this._cpuThrottlingRateMap = new WeakMap();

    // 清理 PageCollector 实例
    this._networkCollector?.dispose();
    this._consoleCollector?.dispose();
    this._wsCollector?.dispose();
    this._networkCollector = null;
    this._consoleCollector = null;
    this._wsCollector = null;
  }

  // ─── Browser / Context 管理 ──────────────────────────

  setBrowser(browser: Browser): void {
    this._browser = browser;
  }

  getBrowser(): Browser | null {
    return this._browser ?? this._browserManager?.getBrowser() ?? null;
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

  // ─── PageCollector 访问 ───────────────────────────────

  get networkCollector(): NetworkRequestCollector | null {
    return this._networkCollector;
  }

  get consoleCollector(): ConsoleMessageCollector | null {
    return this._consoleCollector;
  }

  get wsCollector(): WsCollector | null {
    return this._wsCollector;
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
    // 参考 McpContext：切换 frame 后重新初始化 debugger
    void this.getDebuggerContext(page).catch(() => {});
    return this.selectedFrame;
  }

  getPages(): Page[] {
    // 优先从 context 获取最新页面列表
    if (this._context) {
      this.pagesList = this._context.pages();
    }
    return this.pagesList;
  }

  /**
   * 从 BrowserContext 同步页面列表，并自动选择第一个可用页面。
   * 参考 McpContext.createPagesSnapshot。
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
    this.selectPage(page);
    // 自动注册收集器（网络收集已在 selectPage → setContext 路径中处理，
    // 但 newPage 可能发生在 setContext 之后，因此显式补充）
    if (!this._networkStorage.has(page)) {
      this._attachPageListeners(page);
    }
    this._attachConsoleListeners(page);
    this._attachWebSocketListeners(page);
    return page;
  }

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
    // 参考 McpContext：页面切换后重新初始化 debugger
    void this.getDebuggerContext(page).catch(() => {});
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

  // ─── Debugger 管理 ───────────────────────────────────

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

    this._debuggerContexts.delete(activePage);
    this._debuggerSessions.delete(activePage);
  }

  // ─── AnalyzerRuntimeServices ───────────────────────────

  get deobfuscator() {
    return this._runtime?.deobfuscator ?? this._fallbackDeobfuscator();
  }

  private _fallbackDeobfuscator() {
    return new Deobfuscator(this._getLlmService());
  }

  get analyzer() {
    return this._runtime?.analyzer ?? this._fallbackAnalyzer();
  }

  private _fallbackAnalyzer() {
    return new CodeAnalyzer(this._getLlmService());
  }

  get summarizer() {
    return this._runtime?.summarizer ?? this._fallbackSummarizer();
  }

  private _fallbackSummarizer() {
    return new AISummarizer(this._getLlmService());
  }

  get cryptoDetector() {
    return this._runtime?.cryptoDetector ?? this._fallbackCryptoDetector();
  }

  private _fallbackCryptoDetector() {
    return new CryptoDetector(this._getLlmService());
  }

  get hookManager() {
    return this._runtime?.hookManager ?? this._fallbackHookManager();
  }

  private _fallbackHookManager() {
    return new HookManager();
  }

  get pageController() {
    return this._runtime?.pageController ?? this._fallbackPageController();
  }

  private _fallbackPageController() {
    return new PageController(this.collector);
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
      this._attachConsoleListeners(page);
      this._attachWebSocketListeners(page);
      // 同步页面列表
      this.pagesList = context.pages();
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
   * 清理 Page 的网络监听和存储
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

  // ─── Console 收集 ────────────────────────────────────

  private _attachConsoleListeners(page: Page): void {
    if (this._consoleStorage.has(page)) {
      return;
    }

    const idGenerator = this._createIdGenerator();
    this._consoleIdGenerators.set(page, idGenerator);
    const storage: PageConsoleStorage = [[]];
    this._consoleStorage.set(page, storage);

    const onConsole = (msg: ConsoleMessage): void => {
      const navigations = this._consoleStorage.get(page);
      if (!navigations) return;
      navigations[0]!.push({stableId: idGenerator(), message: msg});
    };

    const onPageError = (err: Error): void => {
      const navigations = this._consoleStorage.get(page);
      if (!navigations) return;
      navigations[0]!.push({stableId: idGenerator(), message: err});
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    const onFrameNavigated = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      const navigations = this._consoleStorage.get(page);
      if (!navigations) return;
      navigations.unshift([]);
      navigations.splice(this._maxNavigationSaved);
    };
    page.on('framenavigated', onFrameNavigated);

    this._consoleListeners.set(page, {onConsole, onPageError});

    page.once('close', () => {
      this._detachConsoleListeners(page);
    });
  }

  private _detachConsoleListeners(page: Page): void {
    const listeners = this._consoleListeners.get(page);
    if (listeners) {
      try {
        page.off('console', listeners.onConsole);
        page.off('pageerror', listeners.onPageError);
      } catch {
        // Page might already be closed
      }
    }
    this._consoleListeners.delete(page);
    this._consoleStorage.delete(page);
    this._consoleIdGenerators.delete(page);
  }

  // ─── WebSocket 收集 ─────────────────────────────────

  private _attachWebSocketListeners(page: Page): void {
    if (this._webSocketStorage.has(page)) {
      return;
    }

    const idGenerator = this._createIdGenerator();
    this._webSocketIdGenerators.set(page, idGenerator);
    const storage: PageWebSocketStorage = [[]];
    this._webSocketStorage.set(page, storage);
    this._webSocketConnectionMaps.set(page, new Map());
    this._webSocketRequestIdCounters.set(page, 0);

    const onWebSocket = (ws: PlaywrightWebSocket): void => {
      const connectionMap = this._webSocketConnectionMaps.get(page);
      if (!connectionMap) return;

      let counter = this._webSocketRequestIdCounters.get(page) ?? 0;
      counter++;
      this._webSocketRequestIdCounters.set(page, counter);
      const requestId = `ws-${counter}-${Date.now()}`;

      const tracked: TrackedWebSocketData = {
        connection: {
          requestId,
          url: ws.url(),
          status: 'open',
          createdAt: Date.now(),
        },
        frames: [],
        stableId: idGenerator(),
      };

      connectionMap.set(requestId, tracked);
      const navigations = this._webSocketStorage.get(page);
      if (navigations) {
        navigations[0]!.push(tracked);
      }

      ws.on('framereceived', data => {
        const payload =
          typeof data.payload === 'string'
            ? data.payload
            : data.payload.toString('base64');
        const opcode = typeof data.payload === 'string' ? 1 : 2;
        tracked.frames.push({
          requestId,
          direction: 'received',
          timestamp: Date.now(),
          opcode,
          payloadData: payload,
        });
      });

      ws.on('framesent', data => {
        const payload =
          typeof data.payload === 'string'
            ? data.payload
            : data.payload.toString('base64');
        const opcode = typeof data.payload === 'string' ? 1 : 2;
        tracked.frames.push({
          requestId,
          direction: 'sent',
          timestamp: Date.now(),
          opcode,
          payloadData: payload,
        });
      });

      ws.on('close', () => {
        tracked.connection.status = 'closed';
        tracked.connection.closedAt = Date.now();
      });
    };

    const onFrameNavigated = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      const navigations = this._webSocketStorage.get(page);
      if (!navigations) return;
      navigations.unshift([]);
      navigations.splice(this._maxNavigationSaved);
      this._webSocketConnectionMaps.set(page, new Map());
      this._webSocketRequestIdCounters.set(page, 0);
    };

    page.on('websocket', onWebSocket);
    page.on('framenavigated', onFrameNavigated);

    this._webSocketListeners.set(page, {onWebSocket, onFrameNavigated});

    page.once('close', () => {
      this._detachWebSocketListeners(page);
    });
  }

  private _detachWebSocketListeners(page: Page): void {
    const listeners = this._webSocketListeners.get(page);
    if (listeners) {
      try {
        page.off('websocket', listeners.onWebSocket);
        page.off('framenavigated', listeners.onFrameNavigated);
      } catch {
        // Page might already be closed
      }
    }
    this._webSocketListeners.delete(page);
    this._webSocketStorage.delete(page);
    this._webSocketIdGenerators.delete(page);
    this._webSocketConnectionMaps.delete(page);
    this._webSocketRequestIdCounters.delete(page);
  }

  // ─── Dialog 管理 ─────────────────────────────────────

  private _dialogHandler = (dialog: Dialog): void => {
    this._dialog = dialog;
  };

  getDialog(): Dialog | undefined {
    return this._dialog;
  }

  clearDialog(): void {
    this._dialog = undefined;
  }

  // ─── 超时与网络/CPU 条件联动 ─────────────────────────

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

  // ─── ConsoleRuntimeServices ──────────────────────────

  getConsoleData(
    includePreservedMessages?: boolean,
  ): Array<ConsoleMessage | Error> {
    const page = this.selectedPage;
    if (!page) return [];

    const navigations = this._consoleStorage.get(page);
    if (!navigations) return [];

    if (!includePreservedMessages) {
      return navigations[0]!.map(t => t.message);
    }

    const data: Array<ConsoleMessage | Error> = [];
    for (let index = this._maxNavigationSaved; index >= 0; index--) {
      if (navigations[index]) {
        data.push(...navigations[index]!.map(t => t.message));
      }
    }
    return data;
  }

  getConsoleMessageById(id: number): ConsoleMessage | Error {
    const page = this.selectedPage;
    if (!page) {
      throw new Error('未选中页面');
    }
    const navigations = this._consoleStorage.get(page);
    if (!navigations) {
      throw new Error('Console 收集器未初始化');
    }
    for (const navigation of navigations) {
      const found = navigation.find(t => t.stableId === id);
      if (found) return found.message;
    }
    throw new Error(`Console 消息 ID ${id} 未找到`);
  }

  getConsoleMessageStableId(message: unknown): number {
    const candidatePages = this._getNetworkCandidatePages();
    for (const page of candidatePages) {
      const navigations = this._consoleStorage.get(page);
      if (!navigations) continue;
      for (const navigation of navigations) {
        const found = navigation.find(t => t.message === message);
        if (found) return found.stableId;
      }
    }
    return -1;
  }

  // ─── WebSocketRuntimeServices ────────────────────────

  getWebSocketConnections(includePreservedData?: boolean): WebSocketData[] {
    const page = this.selectedPage;
    if (!page) return [];

    const navigations = this._webSocketStorage.get(page);
    if (!navigations) return [];

    if (!includePreservedData) {
      return navigations[0] ?? [];
    }

    const data: WebSocketData[] = [];
    for (let index = this._maxNavigationSaved; index >= 0; index--) {
      if (navigations[index]) {
        data.push(...navigations[index]);
      }
    }
    return data;
  }

  getWebSocketConnectionById(wsid: number): WebSocketData {
    const page = this.selectedPage;
    if (!page) {
      throw new Error('未选中页面');
    }
    const navigations = this._webSocketStorage.get(page);
    if (!navigations) {
      throw new Error('WebSocket 收集器未初始化');
    }
    for (const navigation of navigations) {
      const found = navigation.find(t => t.stableId === wsid);
      if (found) return found;
    }
    throw new Error(`WebSocket ID ${wsid} 未找到`);
  }

  getWebSocketStableId(ws: unknown): number {
    const candidatePages = this._getNetworkCandidatePages();
    for (const page of candidatePages) {
      const navigations = this._webSocketStorage.get(page);
      if (!navigations) continue;
      for (const navigation of navigations) {
        const found = navigation.find(t => t === ws);
        if (found) return found.stableId;
      }
    }
    return -1;
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

  private _llmService: LLMService | null = null;

  private _getLlmService(): LLMService {
    if (this._runtime?.llmService) {
      return this._runtime.llmService;
    }
    if (!this._llmService) {
      this._llmService = new LLMService();
    }
    return this._llmService;
  }
}
