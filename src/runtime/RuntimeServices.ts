/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {getSourceMapConfig} from '../config/servicesConfig.js';
import {DatabaseManager} from '../database/DatabaseManager.js';
import type {PageController} from '../modules/collector/PageController.js';
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

/**
 * 延迟初始化的运行时服务集合。通过 getter 属性按需创建抓包、Wasm、SourceMap 等重服务。
 *
 * @see {@link src/runtime.ts} — getRuntime() 创建 RuntimeServices 并暴露 lazy getter
 */
export class RuntimeServices {
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
