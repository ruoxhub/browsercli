/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {getSourceMapConfig} from '../config/servicesConfig.js';
import type {PageController} from '../modules/collector/PageController.js';
import {NetworkModule} from '../modules/network/index.js';
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
  private wasmAnalyzer?: WasmAnalyzer;
  private wasmDecompiler?: WasmDecompiler;
  private wasmRuntimeInspector?: WasmRuntimeInspector;
  private wasmCollector?: WasmCollector;
  private sourceMapService: SourceMapService | null = null;

  constructor(private readonly pageController: PageController) {}

  getNetworkModule(): NetworkModule {
    return (this.networkModule ??= new NetworkModule());
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
