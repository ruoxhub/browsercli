/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {getBrowserManagerConfig} from './config.js';
import type {AISummarizer} from './modules/analyzer/AISummarizer.js';
import type {CodeAnalyzer} from './modules/analyzer/CodeAnalyzer.js';
import {
  BrowserManager,
  type BrowserManagerConfig,
} from './modules/browser/index.js';
import {CodeCollector} from './modules/collector/CodeCollector.js';
import {DOMInspector} from './modules/collector/DOMInspector.js';
import {PageController} from './modules/collector/PageController.js';
import type {CryptoDetector} from './modules/crypto/CryptoDetector.js';
import type {Deobfuscator} from './modules/deobfuscator/Deobfuscator.js';
import {HookManager} from './modules/hook/HookManager.js';
import type {NetworkModule} from './modules/network/index.js';
import type {WasmAnalyzer} from './modules/wasm/WasmAnalyzer.js';
import type {WasmCollector} from './modules/wasm/WasmCollector.js';
import type {WasmDecompiler} from './modules/wasm/WasmDecompiler.js';
import type {WasmRuntimeInspector} from './modules/wasm/WasmRuntimeInspector.js';
import {ReverseTaskStore} from './reverse/ReverseTaskStore.js';
import {RuntimeServices} from './runtime/RuntimeServices.js';
import type {LLMService} from './services/LLMService.js';
import type {Page} from './third_party/index.js';
import {createAppEventBusOptions, type AppEventMap} from './types/events.js';
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  DetailedDataManagerAdapter,
} from './utils/CacheAdapters.js';
import {DetailedDataManager} from './utils/detailedDataManager.js';
import {EventBus} from './utils/EventBus.js';
import {UnifiedCacheManager} from './utils/UnifiedCacheManager.js';
import type {ToolContextProvider} from './worker/ToolContext.js';
let runtime: Runtime | undefined;

/**
 * 运行时服务集合。所有 MCP 工具通过 getRuntime() 访问共享服务。
 *
 * @stable 此接口被 57+ 个文件消费。新增服务应通过 RuntimeServices lazy getter 暴露，
 * 而不是直接添加到此接口。修改字段前必须运行 impact 分析。
 */
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
  networkModule: NetworkModule;
  wasmCollector: WasmCollector;
  wasmAnalyzer: WasmAnalyzer;
  wasmDecompiler: WasmDecompiler;
  wasmRuntimeInspector: WasmRuntimeInspector;
  reverseTaskStore: ReverseTaskStore;
  eventBus: EventBus<AppEventMap>;
  contextProvider?: ToolContextProvider;
  bindPageContext: (resolver: () => Page) => void;
  syncPageContext: (page: Page) => void;
  clearPageContext: () => void;
}

/**
 * 获取全局运行时实例。
 *
 * @stable 高扇入函数（57+ 调用方）。修改返回类型前必须运行 impact 分析。
 */
export function getRuntime(): Runtime {
  if (runtime) {
    return runtime;
  }
  // 初始化 BrowserManager，将 Page 注入 contextProvider
  // 浏览器配置也从 config.ts 获取（支持 config.json / .env 等）
  const browserConfig: BrowserManagerConfig = getBrowserManagerConfig();
  const browserManager = BrowserManager.getInstance(browserConfig);

  const collector = new CodeCollector(browserConfig, browserManager);
  const domInspector = new DOMInspector(collector);
  const pageController = new PageController(collector);
  const hookManager = new HookManager();
  const services = new RuntimeServices(pageController);
  const detailedDataManager = DetailedDataManager.getInstance();
  const unifiedCacheManager = UnifiedCacheManager.getInstance();
  const reverseTaskStore = new ReverseTaskStore();
  const eventBus = new EventBus<AppEventMap>(createAppEventBusOptions());

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
    get llmService() {
      return services.getLLMService();
    },
    get analyzer() {
      return services.getAnalyzer();
    },
    get summarizer() {
      return services.getSummarizer();
    },
    get deobfuscator() {
      return services.getDeobfuscator();
    },
    get cryptoDetector() {
      return services.getCryptoDetector();
    },
    get networkModule() {
      return services.getNetworkModule();
    },
    get wasmCollector() {
      return services.getWasmCollector();
    },
    get wasmAnalyzer() {
      return services.getWasmAnalyzer();
    },
    get wasmDecompiler() {
      return services.getWasmDecompiler();
    },
    get wasmRuntimeInspector() {
      return services.getWasmRuntimeInspector();
    },
    reverseTaskStore,
    eventBus,
    bindPageContext: resolver => {
      collector.setPageResolver(() => resolver());
    },
    syncPageContext: page => {
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

export function setRuntime(customRuntime: Runtime | undefined): void {
  runtime = customRuntime;
}
