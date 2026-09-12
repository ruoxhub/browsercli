/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {getSourceMapConfig} from '../config/servicesConfig.js';
import {DatabaseManager} from '../database/DatabaseManager.js';
import {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import type {PageController} from '../modules/collector/PageController.js';
import {CryptoDetector} from '../modules/crypto/CryptoDetector.js';
import {NetworkModule} from '../modules/network/index.js';
import {MitmModule, resolveMitmCertsDir} from '../modules/proxy/index.js';
import {fromMitmExchange} from '../modules/session/adapters/index.js';
import {CaptureEngine} from '../modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../modules/session/index.js';
import {SqliteSessionStore} from '../modules/session/SqliteSessionStore.js';
import {SourceMapService} from '../modules/sourcemap/SourceMapService.js';
import {WasmAnalyzer} from '../modules/wasm/WasmAnalyzer.js';
import {WasmCollector} from '../modules/wasm/WasmCollector.js';
import {WasmDecompiler} from '../modules/wasm/WasmDecompiler.js';
import {WasmRuntimeInspector} from '../modules/wasm/WasmRuntimeInspector.js';
import {LLMService} from '../services/LLMService.js';

/**
 * 延迟初始化的运行时服务集合。通过 getter 属性按需创建 AI、分析器、去混淆器等重服务。
 *
 * @see {@link src/runtime.ts} — getRuntime() 创建 RuntimeServices 并暴露 lazy getter
 * @see {@link src/services/AIService.ts} — AI 服务（lazy）
 * @see {@link src/modules/analyzer/CodeAnalyzer.ts} — 代码分析器（lazy）
 */
export class RuntimeServices {
  private llmService?: LLMService;
  private analyzer?: CodeAnalyzer;
  private summarizer?: AISummarizer;
  private cryptoDetector?: CryptoDetector;
  private networkModule?: NetworkModule;
  private mitmModule?: MitmModule;
  private captureSessionManager?: CaptureSessionManager;
  private captureEngine?: CaptureEngine;
  private sessionStore?: SqliteSessionStore;
  private wasmAnalyzer?: WasmAnalyzer;
  private wasmDecompiler?: WasmDecompiler;
  private wasmRuntimeInspector?: WasmRuntimeInspector;
  private wasmCollector?: WasmCollector;
  private sourceMapService: SourceMapService | null = null;

  constructor(
    private readonly pageController: PageController,
    private readonly sessionDbPath?: string,
  ) {}

  getLLMService(): LLMService {
    return (this.llmService ??= new LLMService());
  }

  isAIConfigured(): boolean {
    return this.getLLMService().isConfigured();
  }

  getAnalyzer(): CodeAnalyzer {
    return (this.analyzer ??= new CodeAnalyzer(this.getLLMService()));
  }

  getSummarizer(): AISummarizer {
    return (this.summarizer ??= new AISummarizer(this.getLLMService()));
  }

  getCryptoDetector(): CryptoDetector {
    return (this.cryptoDetector ??= new CryptoDetector(this.getLLMService()));
  }

  getNetworkModule(): NetworkModule {
    return (this.networkModule ??= new NetworkModule());
  }

  getMitmModule(): MitmModule {
    return (this.mitmModule ??= new MitmModule(
      resolveMitmCertsDir(),
      exchange => {
        this.getCaptureEngine().ingestRequest(fromMitmExchange(exchange));
      },
    ));
  }

  /**
   * 会话存储的唯一实例来源：manager 与 engine 必须共享同一个
   * DatabaseManager，否则两个 store 各开句柄、close() 互相踩（spec §7 约束 3）。
   */
  private ensureSessionStore(): SqliteSessionStore {
    return (this.sessionStore ??= new SqliteSessionStore(
      new DatabaseManager(this.sessionDbPath),
    ));
  }

  getCaptureSessionManager(): CaptureSessionManager {
    return (this.captureSessionManager ??= new CaptureSessionManager(
      this.ensureSessionStore(),
    ));
  }

  /** CDP + MITM 双链路的唯一聚合点（spec §3）。 */
  getCaptureEngine(): CaptureEngine {
    return (this.captureEngine ??= new CaptureEngine(
      this.getCaptureSessionManager(),
      this.ensureSessionStore(),
    ));
  }

  getWasmAnalyzer(): WasmAnalyzer {
    return (this.wasmAnalyzer ??= new WasmAnalyzer());
  }

  getWasmDecompiler(): WasmDecompiler {
    return (this.wasmDecompiler ??= new WasmDecompiler());
  }

  getWasmRuntimeInspector(): WasmRuntimeInspector {
    return (this.wasmRuntimeInspector ??= new WasmRuntimeInspector());
  }

  getWasmCollector(): WasmCollector {
    return (this.wasmCollector ??= new WasmCollector(
      this.pageController,
      this.getWasmAnalyzer(),
      this.getWasmRuntimeInspector(),
    ));
  }

  getSourceMapService(): SourceMapService {
    return (this.sourceMapService ??= new SourceMapService(
      getSourceMapConfig(),
    ));
  }
}
