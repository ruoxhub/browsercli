
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {BrowserManager, type BrowserManagerConfig} from './browser/index.js';
import {getEnvBoolean} from './config.js';
import {AISummarizer} from './modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from './modules/analyzer/CodeAnalyzer.js';
import {CodeCollector} from './modules/collector/CodeCollector.js';
import {DOMInspector} from './modules/collector/DOMInspector.js';
import {PageController} from './modules/collector/PageController.js';
import {CryptoDetector} from './modules/crypto/CryptoDetector.js';
import {Deobfuscator} from './modules/deobfuscator/Deobfuscator.js';
import {HookManager} from './modules/hook/HookManager.js';
import {WasmAnalyzer} from './modules/wasm/WasmAnalyzer.js';
import {WasmCollector} from './modules/wasm/WasmCollector.js';
import {WasmDecompiler} from './modules/wasm/WasmDecompiler.js';
import {WasmRuntimeInspector} from './modules/wasm/WasmRuntimeInspector.js';
import {ReverseTaskStore} from './reverse/ReverseTaskStore.js';
import {LLMService} from './services/LLMService.js';
import type {Page} from './third_party/index.js';
import type {WorkerStartOptions} from './types/platform.js';
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  DetailedDataManagerAdapter,
} from './utils/CacheAdapters.js';
import {DetailedDataManager} from './utils/detailedDataManager.js';
import {UnifiedCacheManager} from './utils/UnifiedCacheManager.js';
import {getBrowserConfig} from './config.js';
let runtime: Runtime | undefined;

export interface Runtime {
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
  wasmCollector: WasmCollector;
  wasmAnalyzer: WasmAnalyzer;
  wasmDecompiler: WasmDecompiler;
  wasmRuntimeInspector: WasmRuntimeInspector;
  reverseTaskStore: ReverseTaskStore;
  bindPageContext: (resolver: () => Page) => void;
  syncPageContext: (page: Page) => void;
  clearPageContext: () => void;
}


export function getRuntime(): Runtime {
  if (runtime) {
    return runtime;
  }
  // 初始化 BrowserManager，将 Page 注入 contextProvider
  // 浏览器配置也从 config.ts 获取（支持 config.json / .env 等）
  const browserConfig: BrowserManagerConfig = getBrowserConfig();
  const browserManager = BrowserManager.getInstance(browserConfig);

  const collector = new CodeCollector(browserConfig, browserManager);
  const domInspector = new DOMInspector(collector);
  const pageController = new PageController(collector);
  const hookManager = new HookManager();
  const llmService = new LLMService();
  const wasmAnalyzer = new WasmAnalyzer();
  const wasmDecompiler = new WasmDecompiler();
  const wasmRuntimeInspector = new WasmRuntimeInspector();
  const detailedDataManager = DetailedDataManager.getInstance();
  const unifiedCacheManager = UnifiedCacheManager.getInstance();
  const reverseTaskStore = new ReverseTaskStore();

  unifiedCacheManager.registerCache(new DetailedDataManagerAdapter(detailedDataManager));
  unifiedCacheManager.registerCache(new CodeCacheAdapter(collector.getCache()));
  unifiedCacheManager.registerCache(new CodeCompressorAdapter(collector.getCompressor()));

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
    wasmCollector: new WasmCollector(pageController, wasmAnalyzer, wasmRuntimeInspector),
    wasmAnalyzer,
    wasmDecompiler,
    wasmRuntimeInspector,
    reverseTaskStore,
    bindPageContext: (resolver) => {
      collector.setPageResolver(() => resolver());
    },
    syncPageContext: (page) => {
      collector.setPageResolver(() => page);
      browserManager.setCurrentPage(page);
    },
    clearPageContext: () => {
      collector.setPageResolver(undefined);
      browserManager.setCurrentPage(null);
    },
  };

  return runtime;
}
