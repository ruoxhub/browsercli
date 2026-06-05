/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ServiceLocator — 分析/Hook/协同服务的惰性提供者
 *
 * 设计：
 * - 若 Runtime 已在 worker 入口预先装配，则优先复用 Runtime 中的实例，
 *   避免重复创建 LLMService、Deobfuscator 等开销较大的对象；
 * - 若未注入 Runtime（如单元测试场景），则按需创建 fallback 实例，
 *   保持 ToolContextProvider 的可独立实例化语义。
 *
 * 注意：ServiceLocator 不缓存 Runtime 提供的实例，仅在 fallback 路径缓存。
 */

import type {BrowserManager} from '../../browser/index.js';
import {AISummarizer} from '../../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../../modules/analyzer/CodeAnalyzer.js';
import {CodeCollector} from '../../modules/collector/CodeCollector.js';
import {PageController} from '../../modules/collector/PageController.js';
import {CryptoDetector} from '../../modules/crypto/CryptoDetector.js';
import {Deobfuscator} from '../../modules/deobfuscator/Deobfuscator.js';
import {HookManager} from '../../modules/hook/HookManager.js';
import type {Runtime} from '../../runtime.js';
import {LLMService} from '../../services/LLMService.js';

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

  // ─── Runtime / Browser 注入 ──────────────────────────

  setBrowserManager(browserManager: BrowserManager): void {
    this._browserManager = browserManager;
  }

  getBrowserManager(): BrowserManager | null {
    return this._browserManager;
  }

  // ─── 惰性加载辅助 ─────────────────────────────────────

  private getOrCreate<T>(
    cached: T | null,
    runtimeKey: keyof Runtime,
    factory: () => T,
  ): T {
    const fromRuntime = this._runtime?.[runtimeKey] as T | undefined;
    if (fromRuntime) return fromRuntime;
    return cached ?? factory();
  }

  // ─── CodeCollector（必须持有 BrowserManager）──────────

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

  // ─── LLM 服务 ───────────────────────────────────────

  getLlmService(): LLMService {
    return this.getOrCreate(this._llmService, 'llmService', () => {
      this._llmService = new LLMService();
      return this._llmService;
    });
  }

  // ─── 分析服务 ───────────────────────────────────────

  getDeobfuscator(): Deobfuscator {
    return this.getOrCreate(this._deobfuscator, 'deobfuscator', () => {
      this._deobfuscator = new Deobfuscator(this.getLlmService());
      return this._deobfuscator;
    });
  }

  getAnalyzer(): CodeAnalyzer {
    return this.getOrCreate(this._analyzer, 'analyzer', () => {
      this._analyzer = new CodeAnalyzer(this.getLlmService());
      return this._analyzer;
    });
  }

  getSummarizer(): AISummarizer {
    return this.getOrCreate(this._summarizer, 'summarizer', () => {
      this._summarizer = new AISummarizer(this.getLlmService());
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
