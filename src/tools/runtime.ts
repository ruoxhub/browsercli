/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {BrowserManager, type BrowserManagerConfig} from '../browser.js';
import {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import {CodeCollector} from '../modules/collector/CodeCollector.js';
import {DOMInspector} from '../modules/collector/DOMInspector.js';
import {PageController} from '../modules/collector/PageController.js';
import {CryptoDetector} from '../modules/crypto/CryptoDetector.js';
import {Deobfuscator} from '../modules/deobfuscator/Deobfuscator.js';
import {HookManager} from '../modules/hook/HookManager.js';
import {ReverseTaskStore} from '../reverse/ReverseTaskStore.js';
import {LLMService} from '../services/LLMService.js';
import type {Page} from '../third_party/index.js';
import type {PuppeteerConfig} from '../types/index.js';
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  DetailedDataManagerAdapter,
} from '../utils/CacheAdapters.js';
import {getBrowserConfig} from '../utils/config.js';
import {DetailedDataManager} from '../utils/detailedDataManager.js';
import {UnifiedCacheManager} from '../utils/UnifiedCacheManager.js';

let runtime: JSHookRuntime | undefined;

export interface JSHookRuntime {
  browserManager: BrowserManager;
  collector: CodeCollector;
  domInspector: DOMInspector;
  pageController: PageController;
  hookManager: HookManager;
  llmService: LLMService;
  analyzer: CodeAnalyzer;
  summarizer: AISummarizer;
  deobfuscator: Deobfuscator;
  cryptoDetector: CryptoDetector;
  reverseTaskStore: ReverseTaskStore;
  /** @deprecated Use setPageContext instead */
  bindPageContext: (resolver: () => Page) => void;
  /** @deprecated Use setPageContext instead */
  syncPageContext: (page: Page) => void;
  setPageContext: (page: Page | (() => Page)) => void;
  clearPageContext: () => void;
}

function toCollectorConfig(): PuppeteerConfig {
  const browser = getBrowserConfig();
  return {
    headless: browser.headless!,
    timeout: 30000,
    remoteDebuggingUrl: browser.remoteDebuggingUrl,
    useStealthScripts: browser.useStealthScripts,
    viewport: browser.viewport,
  };
}

export function getJSHookRuntime(): JSHookRuntime {
  if (runtime) {
    return runtime;
  }

  const browser = getBrowserConfig();
  const config: BrowserManagerConfig = {
    remoteDebuggingUrl:
      process.env.REMOTE_DEBUGGING_URL || browser.remoteDebuggingUrl,
    remoteDebuggingPort: process.env.REMOTE_DEBUGGING_PORT
      ? Number(process.env.REMOTE_DEBUGGING_PORT)
      : 9222,
    useStealthScripts:
      process.env.USE_STEALTH_SCRIPTS !== 'false' && browser.useStealthScripts,
    autoLaunch: false, // daemon 模式下不自动启动浏览器，由用户手动启动
    viewport: browser.viewport,
  };

  const browserManager = BrowserManager.getInstance(config);

  const collector = new CodeCollector(toCollectorConfig(), browserManager);
  const domInspector = new DOMInspector(collector);
  const pageController = new PageController(collector);
  const hookManager = new HookManager();
  const llmService = new LLMService();
  const detailedDataManager = DetailedDataManager.getInstance();
  const unifiedCacheManager = UnifiedCacheManager.getInstance();
  const reverseTaskStore = new ReverseTaskStore();

  unifiedCacheManager.registerCache(
    new DetailedDataManagerAdapter(detailedDataManager),
  );
  unifiedCacheManager.registerCache(new CodeCacheAdapter(collector.getCache()));
  unifiedCacheManager.registerCache(
    new CodeCompressorAdapter(collector.getCompressor()),
  );

  runtime = {
    browserManager,
    collector,
    domInspector,
    pageController,
    hookManager,
    llmService,
    analyzer: new CodeAnalyzer(llmService),
    summarizer: new AISummarizer(llmService),
    deobfuscator: new Deobfuscator(llmService),
    cryptoDetector: new CryptoDetector(llmService),
    reverseTaskStore,
    bindPageContext: resolver => {
      collector.setPageResolver(() => resolver());
    },
    syncPageContext: page => {
      collector.setPageResolver(() => page);
    },
    setPageContext: page => {
      collector.setPageResolver(typeof page === 'function' ? page : () => page);
    },
    clearPageContext: () => {
      collector.setPageResolver(undefined);
    },
  };

  return runtime;
}
