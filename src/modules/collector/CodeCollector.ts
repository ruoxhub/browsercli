/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 代码收集模块 - 门面层
 *
 * 功能:
 * - 收集页面内联脚本
 * - 收集外部脚本文件
 * - 收集动态加载的脚本
 * - 收集Service Worker和Web Worker
 * - CDP会话控制和网络监控
 * - 反检测和资源拦截
 *
 * 架构: 本类为门面，具体职责委托给三个策略模块：
 * - CollectedFileRegistry: 文件缓存管理 + URL 去重 + 元数据构造
 * - CdpNetworkMonitor: CDP 会话生命周期 + 网络响应抓取
 * - DynamicScriptWatcher: 动态脚本等待（network idle / 时间等待）
 */

import type {Browser, Page} from '../../third_party/index.js';
import type {
  CollectCodeOptions,
  CollectCodeResult,
  CodeFile,
  DependencyGraph,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import type {BrowserManager, BrowserManagerConfig} from '../browser/index.js';

import {CdpNetworkMonitor} from './CdpNetworkMonitor.js';
import {CodeCache} from './CodeCache.js';
import {CodeCompressor} from './CodeCompressor.js';
import {CollectedFileRegistry} from './CollectedFileRegistry.js';
import {DynamicScriptWatcher} from './DynamicScriptWatcher.js';
import {PageScriptCollector} from './PageScriptCollector.js';
import {
  SmartCodeCollector,
  type CodeSummary,
  type SmartCollectOptions,
} from './SmartCodeCollector.js';
// import { StreamingCollector } from './StreamingCollector.js'; // 暂不使用

export class CodeCollector {
  private config: BrowserManagerConfig;
  private readonly browserManager: BrowserManager;
  private browser: Browser | null = null;
  private browserListenerAttached = false;

  private readonly userAgent: string;

  // ✅ 缓存
  private cache: CodeCache;
  private cacheEnabled = true;

  // 🆕 智能收集、压缩
  private smartCollector: SmartCodeCollector;
  private compressor: CodeCompressor;

  // 🆕 策略模块（替代原散落在门面中的状态）
  private readonly fileRegistry: CollectedFileRegistry;
  private readonly cdpMonitor: CdpNetworkMonitor;
  private readonly scriptWatcher: DynamicScriptWatcher;
  private readonly pageScriptCollector: PageScriptCollector;

  private pageResolver?: () => Page | null | undefined;

  constructor(config: BrowserManagerConfig, browserManager: BrowserManager) {
    this.config = config;
    this.browserManager = browserManager;

    this.fileRegistry = new CollectedFileRegistry({
      maxCollectedUrls: config.maxCollectedUrls,
      maxFilesPerCollect: config.maxFilesPerCollect,
      maxResponseSize: config.maxTotalContentSize,
      maxSingleFileSize: config.maxSingleFileSize,
    });
    this.cdpMonitor = new CdpNetworkMonitor();
    this.scriptWatcher = new DynamicScriptWatcher();
    this.pageScriptCollector = new PageScriptCollector();

    this.userAgent =
      config.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    // 初始化所有模块
    this.cache = new CodeCache();
    this.smartCollector = new SmartCodeCollector();
    this.compressor = new CodeCompressor();

    logger.info(
      `📊 CodeCollector limits: maxCollect=${this.fileRegistry.MAX_FILES_PER_COLLECT} files, maxResponse=${(this.fileRegistry.MAX_RESPONSE_SIZE / 1024).toFixed(0)}KB, maxSingle=${(this.fileRegistry.MAX_SINGLE_FILE_SIZE / 1024).toFixed(0)}KB`,
    );
    logger.info(
      `💡 Strategy: Collect ALL files → Cache → Return summary/partial data to fit MCP limits`,
    );
  }

  /**
   * 启用/禁用缓存
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    logger.info(`Code cache ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 清空文件缓存
   */
  async clearFileCache(): Promise<void> {
    await this.cache.clear();
  }

  /**
   * 获取文件缓存统计
   */
  async getFileCacheStats() {
    return await this.cache.getStats();
  }

  /**
   * 🆕 清除所有收集数据（换网站时调用）
   */
  async clearAllData(): Promise<void> {
    logger.info('🧹 Clearing all collected data...');

    // 清除文件缓存
    await this.cache.clear();

    // 清除压缩缓存
    this.compressor.clearCache();

    // 重置压缩统计
    this.compressor.resetStats();

    // 清除文件注册表（URL 去重 + 文件缓存）
    this.fileRegistry.clear();

    logger.success('✅ All data cleared');
  }

  /**
   * 🆕 获取所有统计信息
   */
  async getAllStats() {
    const cacheStats = await this.cache.getStats();
    const compressionStats = this.compressor.getStats();
    const fileStats = this.fileRegistry.getStats();

    return {
      cache: cacheStats,
      compression: {
        ...compressionStats,
        cacheSize: this.compressor.getCacheSize(),
      },
      collector: {
        collectedUrls: fileStats.urlCount,
        maxCollectedUrls: fileStats.maxCollectedUrls,
      },
    };
  }

  /**
   * 🆕 获取缓存实例（用于 UnifiedCacheManager）
   */
  public getCache(): CodeCache {
    return this.cache;
  }

  /**
   * 🆕 获取压缩器实例（用于 UnifiedCacheManager）
   */
  public getCompressor(): CodeCompressor {
    return this.compressor;
  }

  /**
   * 使用外部上下文提供当前页面，优先级高于内部浏览器管理状态。
   */
  setPageResolver(resolver?: () => Page | null | undefined): void {
    this.pageResolver = resolver;
  }

  /**
   * 初始化浏览器 - 统一由 BrowserModeManager 管理
   */
  async init(): Promise<void> {
    if (this.browser && this.browser.isConnected()) {
      return;
    }

    logger.info('Initializing browser via BrowserModeManager...');
    this.browser = await this.browserManager.launch();

    if (!this.browser) {
      throw new Error('Browser failed to initialize');
    }

    if (!this.browserListenerAttached) {
      this.browser.on('disconnected', () => {
        logger.warn('⚠️  Browser disconnected');
        this.browser = null;
        // 浏览器断开时清除 CDP 会话引用
        this.cdpMonitor.reset();
        this.browserListenerAttached = false;
      });
      this.browserListenerAttached = true;
    }

    // 🆕 初始化缓存目录
    await this.cache.init();

    logger.success('Browser initialized via BrowserModeManager');
  }

  /**
   * 关闭浏览器并清理所有数据
   */
  async close(): Promise<void> {
    // 🆕 先清理数据
    await this.clearAllData();

    // 再关闭浏览器
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.browserListenerAttached = false;
      logger.info('Browser closed and all data cleared');
    }
  }

  /**
   * 🆕 获取当前活动的Page实例
   */
  async getActivePage(): Promise<Page> {
    let resolvedPage = this.pageResolver?.();
    if (resolvedPage && !resolvedPage.isClosed()) {
      return resolvedPage;
    }

    if (!this.browser || !this.browser.isConnected()) {
      await this.init();
    }

    resolvedPage = this.pageResolver?.();
    if (resolvedPage && !resolvedPage.isClosed()) {
      return resolvedPage;
    }

    const managedPage = this.browserManager.getCurrentPage();
    if (managedPage && !managedPage.isClosed()) {
      return managedPage;
    }

    if (this.browser) {
      const context = this.browser.contexts()[0];
      const pages = context ? await context.pages() : [];
      const usablePages = pages.filter(page => !page.isClosed());
      if (usablePages.length > 0) {
        const fallbackPage = usablePages[usablePages.length - 1];
        if (fallbackPage && !fallbackPage.isClosed()) {
          return fallbackPage;
        }
      }
    }

    return await this.browserManager.newPage();
  }

  /**
   * 🆕 创建新页面
   */
  async createPage(url?: string): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.init();
    }

    const page = await this.browserManager.newPage();

    // 🆕 设置User-Agent（使用配置）- Playwright: set via CDP
    const cdpForUA = await page.context().newCDPSession(page);
    await cdpForUA.send('Network.setUserAgentOverride', {
      userAgent: this.userAgent,
    });
    await cdpForUA.detach();

    // BrowserModeManager已在newPage()时自动注入反检测脚本，无需重复注入

    if (url) {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.config.timeout,
      });
    }

    logger.info(`New page created${url ? `: ${url}` : ''}`);
    return page;
  }

  /**
   * 🆕 获取浏览器状态
   *
   * ✅ 修复：移除 isConnected() 的使用，使用 try-catch 检测浏览器状态
   * 原因：isConnected() 已弃用，且在页面导航时可能误判
   */
  async getStatus(): Promise<{
    running: boolean;
    pagesCount: number;
    version?: string;
  }> {
    const browser = await this.resolveBrowser();
    if (!browser) {
      return {running: false, pagesCount: 0};
    }

    try {
      // 尝试获取 pages，如果浏览器已关闭会抛出异常
      const context = browser.contexts()[0];
      const pages = context ? await context.pages() : [];
      return {
        running: true,
        pagesCount: pages.length,
        version: browser.version(),
      };
    } catch (error) {
      // 浏览器已关闭或连接断开
      logger.debug('Browser not running or disconnected:', error);
      return {
        running: false,
        pagesCount: 0,
      };
    }
  }

  /**
   * 解析可用的浏览器实例（优先使用 BrowserManager 托管的实例）
   */
  private async resolveBrowser(): Promise<Browser | null> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    const managedBrowser = this.browserManager.getBrowser();
    if (managedBrowser && managedBrowser.isConnected()) {
      this.browser = managedBrowser;
      return managedBrowser;
    }
    return null;
  }

  /**
   * 收集代码 - 完整增强版
   *
   * 增强功能:
   * 1. CDP网络拦截 - 更底层的脚本收集
   * 2. 反检测技术 - 绕过webdriver检测
   * 3. 动态脚本监控 - MutationObserver监听DOM变化
   * 4. 内存泄漏防护 - 自动清理收集的URL
   * 5. 错误恢复 - 异常处理和资源释放
   *
   * 编排流程：setup → CDP attach → navigate → collect inline/workers → wait dynamic → post-process
   */
  async collect(options: CollectCodeOptions): Promise<CollectCodeResult> {
    const startTime = Date.now();
    logger.info(`Collecting code from: ${options.url}`);

    // 🛡️ Guard: pageResolver 未设置或返回空时，提前返回友好错误
    if (!this.pageResolver?.()) {
      return {
        files: [],
        dependencies: {nodes: [], edges: []},
        totalSize: 0,
        collectTime: Date.now() - startTime,
        error: 'NO_PAGE_CONTEXT',
        message:
          '页面上下文未就绪。请先调用 select_page 或 new_page 选择一个页面。',
      };
    }

    // ✅ 检查缓存
    if (this.cacheEnabled) {
      const cached = await this.cache.get(options.url, options as any);
      if (cached) {
        logger.info(`✅ Cache hit for: ${options.url}`);
        return cached;
      }
    }

    await this.init();
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browserManager.newPage();

    try {
      this.configurePageTimeouts(page, options);
      await this.applyUserAgentOverride(page);

      const files = await this.collectAllScripts(page, options);
      return await this.finalizeCollection(page, options, files, startTime);
    } catch (error) {
      logger.error('Code collection failed', error);
      throw error;
    } finally {
      // ✅ 修复：在finally块中清理CDP会话，确保无论是否异常都能正确清理
      await this.cdpMonitor.detach();
      // 最后关闭页面
      await page.close();
    }
  }

  /**
   * 配置页面超时
   */
  private configurePageTimeouts(page: Page, options: CollectCodeOptions): void {
    const timeoutValue = options.timeout || this.config.timeout;
    page.setDefaultTimeout(timeoutValue);
    page.setDefaultNavigationTimeout(timeoutValue);
  }

  /**
   * 通过 CDP 设置 User-Agent 覆盖
   */
  private async applyUserAgentOverride(page: Page): Promise<void> {
    const cdpForUA = await page.context().newCDPSession(page);
    await cdpForUA.send('Network.setUserAgentOverride', {
      userAgent: this.userAgent,
    });
    await cdpForUA.detach();
    // BrowserModeManager已在newPage()时自动注入反检测脚本，无需重复注入
  }

  /**
   * 阶段 1-4: 收集所有脚本（外部 CDP + 内联 + Workers + 动态等待）
   *
   * CDP 监听器必须在 page.goto 之前注册，以捕获导航期间的网络响应。
   * 抓取逻辑由 CdpNetworkMonitor 内部实现，通过 fileRegistry 进行去重和缓存。
   */
  private async collectAllScripts(
    page: Page,
    options: CollectCodeOptions,
  ): Promise<CodeFile[]> {
    const files: CodeFile[] = [];

    // ✅ 注册 CDP 网络监听器（在导航前）—— 抓取逻辑封装在 monitor 内
    await this.cdpMonitor.attach(page, files, this.fileRegistry);

    // 访问页面
    logger.info(`Navigating to: ${options.url}`);
    await page.goto(options.url, {
      waitUntil: 'networkidle',
      timeout: options.timeout || this.config.timeout,
    });

    // 收集内联脚本
    if (options.includeInline !== false) {
      logger.info('Collecting inline scripts...');
      files.push(...(await this.collectInlineScripts(page)));
    }

    // 收集Service Worker
    if (options.includeServiceWorker !== false) {
      logger.info('Collecting Service Workers...');
      files.push(...(await this.collectServiceWorkers(page)));
    }

    // 收集Web Worker
    if (options.includeWebWorker !== false) {
      logger.info('Collecting Web Workers...');
      files.push(...(await this.collectWebWorkers(page)));
    }

    // 收集动态加载的脚本
    if (options.includeDynamic) {
      const dynamicWaitMs =
        options.dynamicWaitMs ??
        Math.min(3000, options.timeout ?? this.config.timeout);
      logger.info(`Waiting for dynamic scripts (up to ${dynamicWaitMs}ms)...`);
      await this.scriptWatcher.waitForStability(page, dynamicWaitMs);
    }

    return files;
  }

  /**
   * 收集后处理：统计、智能收集、压缩、依赖分析、缓存写入。
   *
   * 注意：summary 模式会早返回（绕过压缩与依赖分析），返回 summaries 列表。
   */
  private async finalizeCollection(
    page: Page,
    options: CollectCodeOptions,
    files: CodeFile[],
    startTime: number,
  ): Promise<CollectCodeResult> {
    const collectTime = Date.now() - startTime;
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    // ✅ 统计截断的文件
    const truncatedFiles = files.filter(f => f.metadata?.truncated);
    if (truncatedFiles.length > 0) {
      logger.warn(
        `⚠️  ${truncatedFiles.length} files were truncated due to size limits`,
      );
      truncatedFiles.forEach(f => {
        const originalSize =
          typeof f.metadata?.originalSize === 'number'
            ? f.metadata.originalSize
            : f.size;
        logger.warn(
          `  - ${f.url}: ${(originalSize / 1024).toFixed(2)} KB -> ${(f.size / 1024).toFixed(2)} KB`,
        );
      });
    }

    // 🆕 智能收集处理
    let processedFiles = files;
    if (options.smartMode && options.smartMode !== 'full') {
      try {
        logger.info(`🧠 Applying smart collection mode: ${options.smartMode}`);

        const smartOptions: SmartCollectOptions = {
          mode: options.smartMode,
          maxTotalSize: options.maxTotalSize,
          maxFileSize: options.maxFileSize,
          priorities: options.priorities,
        };

        const smartResult = await this.smartCollector.smartCollect(
          page,
          files,
          smartOptions,
        );

        // 摘要模式直接返回 summaries（不包含完整文件）
        if (options.smartMode === 'summary') {
          const summaries = this.asSummaries(smartResult);
          if (summaries) {
            logger.info(`📊 Returning ${summaries.length} code summaries`);
            return {
              files: [],
              summaries,
              dependencies: {nodes: [], edges: []},
              totalSize: 0,
              collectTime: Date.now() - startTime,
            };
          }
        }

        // priority / incremental 模式：使用 CodeFile[]
        const filteredFiles = this.asCodeFiles(smartResult);
        if (filteredFiles) {
          processedFiles = filteredFiles;
        } else {
          logger.warn(
            'Smart collection returned unexpected type, using original files',
          );
        }
      } catch (error) {
        logger.error('Smart collection failed, using original files:', error);
      }
    }

    // 🆕 压缩处理
    if (options.compress) {
      await this.applyCompression(processedFiles);
    }

    // 分析依赖关系
    const dependencies = this.analyzeDependencies(processedFiles);

    logger.success(
      `Collected ${processedFiles.length} files (${(totalSize / 1024).toFixed(2)} KB) in ${collectTime}ms`,
    );

    const result: CollectCodeResult = {
      files: processedFiles,
      dependencies,
      totalSize,
      collectTime,
    };

    // ✅ 保存到缓存
    if (this.cacheEnabled) {
      await this.cache.set(options.url, result, options as any);
      logger.debug(`💾 Saved to cache: ${options.url}`);
    }

    return result;
  }

  /**
   * 应用压缩处理（增强版 - 使用批量压缩和智能级别选择）
   */
  private async applyCompression(processedFiles: CodeFile[]): Promise<void> {
    try {
      logger.info(
        `🗜️  Compressing ${processedFiles.length} files with enhanced compressor...`,
      );

      const filesToCompress = processedFiles
        .filter(file => this.compressor.shouldCompress(file.content))
        .map(file => ({
          url: file.url,
          content: file.content,
        }));

      if (filesToCompress.length === 0) {
        logger.info('No files need compression (all below threshold)');
        return;
      }

      // 使用批量压缩（并发优化）
      const compressedResults = await this.compressor.compressBatch(
        filesToCompress,
        {
          level: undefined, // 自动选择级别
          useCache: true,
          maxRetries: 3,
          concurrency: 5,
          onProgress: progress => {
            if (progress % 25 === 0) {
              logger.debug(`Compression progress: ${progress.toFixed(0)}%`);
            }
          },
        },
      );

      // 更新文件元数据
      const compressedMap = new Map(compressedResults.map(r => [r.url, r]));

      for (const file of processedFiles) {
        const compressed = compressedMap.get(file.url);
        if (compressed) {
          file.metadata = {
            ...file.metadata,
            compressed: true,
            originalSize: compressed.originalSize,
            compressedSize: compressed.compressedSize,
            compressionRatio: compressed.compressionRatio,
          };
        }
      }

      // 获取压缩统计
      const stats = this.compressor.getStats();
      logger.info(
        `✅ Compressed ${compressedResults.length}/${processedFiles.length} files`,
      );
      logger.info(
        `📊 Compression stats: ${(stats.totalOriginalSize / 1024).toFixed(2)} KB -> ${(stats.totalCompressedSize / 1024).toFixed(2)} KB (${stats.averageRatio.toFixed(1)}% reduction)`,
      );
      logger.info(
        `⚡ Cache: ${stats.cacheHits} hits, ${stats.cacheMisses} misses (${stats.cacheHits > 0 ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) : 0}% hit rate)`,
      );
    } catch (error) {
      logger.error('Compression failed:', error);
      // 继续执行，不影响主流程
    }
  }

  /** 收集内联脚本 — 委托给 pageScriptCollector */
  private async collectInlineScripts(page: Page): Promise<CodeFile[]> {
    return this.pageScriptCollector.collectInlineScripts(
      page,
      this.fileRegistry,
    );
  }

  /** 收集 Service Worker 脚本 — 委托给 pageScriptCollector */
  private async collectServiceWorkers(page: Page): Promise<CodeFile[]> {
    return this.pageScriptCollector.collectServiceWorkers(page);
  }

  /** 收集 Web Worker 脚本 — 委托给 pageScriptCollector */
  private async collectWebWorkers(page: Page): Promise<CodeFile[]> {
    return this.pageScriptCollector.collectWebWorkers(page);
  }

  /** 分析文件依赖关系 — 委托给 pageScriptCollector */
  private analyzeDependencies(files: CodeFile[]): DependencyGraph {
    return this.pageScriptCollector.analyzeDependencies(files);
  }

  /**
   * 检查URL是否应该被收集（过滤规则）
   */
  shouldCollectUrl(url: string, filterRules?: string[]): boolean {
    if (!filterRules || filterRules.length === 0) {
      return true;
    }

    // 支持简单的通配符匹配
    for (const rule of filterRules) {
      const regex = new RegExp(rule.replace(/\*/g, '.*'));
      if (regex.test(url)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 带重试的页面导航
   */
  async navigateWithRetry(
    page: Page,
    url: string,
    options: {waitUntil?: any; timeout?: number},
    maxRetries = 3,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await page.goto(url, options);
        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `Navigation attempt ${i + 1}/${maxRetries} failed: ${error}`,
        );
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }

    throw lastError || new Error('Navigation failed after retries');
  }

  /**
   * 获取页面性能指标
   */
  async getPerformanceMetrics(page: Page): Promise<Record<string, number>> {
    try {
      const metrics = await page.evaluate(() => {
        const perf = performance.getEntriesByType(
          'navigation',
        )[0] as PerformanceNavigationTiming;
        return {
          domContentLoaded:
            perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
          loadComplete: perf.loadEventEnd - perf.loadEventStart,
          domInteractive: perf.domInteractive - perf.fetchStart,
          totalTime: perf.loadEventEnd - perf.fetchStart,
        };
      });
      return metrics;
    } catch (error) {
      logger.warn('Failed to get performance metrics', error);
      return {};
    }
  }

  /**
   * 收集页面元数据
   */
  async collectPageMetadata(page: Page): Promise<Record<string, unknown>> {
    try {
      const metadata = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          userAgent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          cookies: document.cookie,
          localStorage: Object.keys(localStorage).length,
          sessionStorage: Object.keys(sessionStorage).length,
        };
      });
      return metadata;
    } catch (error) {
      logger.warn('Failed to collect page metadata', error);
      return {};
    }
  }

  /**
   * 获取浏览器实例
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * 获取收集统计信息 — 委托给 fileRegistry
   */
  getCollectionStats(): {totalCollected: number; uniqueUrls: number} {
    const fileStats = this.fileRegistry.getStats();
    return {
      totalCollected: fileStats.urlCount,
      uniqueUrls: fileStats.urlCount,
    };
  }

  /**
   * 清除收集缓存（仅 URL 去重集合，保留文件缓存）— 委托给 fileRegistry
   */
  clearCache(): void {
    this.fileRegistry.clearUrls();
    logger.info('Collection cache cleared');
  }

  // ==================== 🆕 按需获取接口（委托给 fileRegistry）====================

  /** 获取已收集文件的摘要列表（轻量级，不包含文件内容） */
  getCollectedFilesSummary(): Array<{
    url: string;
    size: number;
    type: string;
    truncated?: boolean;
    originalSize?: number;
  }> {
    return this.fileRegistry.getCollectedFilesSummary();
  }

  /** 按 URL 获取单个文件内容 */
  getFileByUrl(url: string): CodeFile | null {
    return this.fileRegistry.getFileByUrl(url);
  }

  /** 按 URL 模式批量获取文件 */
  getFilesByPattern(
    pattern: string,
    limit?: number,
    maxTotalSize?: number,
  ): ReturnType<CollectedFileRegistry['getFilesByPattern']> {
    return this.fileRegistry.getFilesByPattern(pattern, limit, maxTotalSize);
  }

  /** 按优先级获取前 N 个文件 */
  getTopPriorityFiles(
    topN?: number,
    maxTotalSize?: number,
  ): ReturnType<CollectedFileRegistry['getTopPriorityFiles']> {
    return this.fileRegistry.getTopPriorityFiles(topN, maxTotalSize);
  }

  /** 清除文件缓存 — 委托给 fileRegistry */
  clearCollectedFilesCache(): void {
    const count = this.fileRegistry.clearFiles();
    logger.info(`🧹 Cleared collected files cache (${count} files)`);
  }

  /**
   * 类型守卫：将智能收集结果窄化为 CodeSummary 数组
   */
  private asSummaries(
    result: CodeFile[] | CodeSummary[],
  ): CodeSummary[] | null {
    if (
      Array.isArray(result) &&
      result.length > 0 &&
      result[0] &&
      'hasEncryption' in result[0]
    ) {
      return result as CodeSummary[];
    }
    return null;
  }

  /**
   * 类型守卫：将智能收集结果窄化为 CodeFile 数组
   */
  private asCodeFiles(result: CodeFile[] | CodeSummary[]): CodeFile[] | null {
    if (
      Array.isArray(result) &&
      (result.length === 0 || (result[0] && 'content' in result[0]))
    ) {
      return result as CodeFile[];
    }
    return null;
  }
}
