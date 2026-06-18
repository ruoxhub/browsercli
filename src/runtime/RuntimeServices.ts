/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import type {PageController} from '../modules/collector/PageController.js';
import {CryptoDetector} from '../modules/crypto/CryptoDetector.js';
import {Deobfuscator} from '../modules/deobfuscator/Deobfuscator.js';
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
 * @see {@link src/modules/deobfuscator/Deobfuscator.ts} — 去混淆器（lazy）
 */
export class RuntimeServices {
  private llmService?: LLMService;
  private analyzer?: CodeAnalyzer;
  private summarizer?: AISummarizer;
  private deobfuscator?: Deobfuscator;
  private cryptoDetector?: CryptoDetector;
  private wasmAnalyzer?: WasmAnalyzer;
  private wasmDecompiler?: WasmDecompiler;
  private wasmRuntimeInspector?: WasmRuntimeInspector;
  private wasmCollector?: WasmCollector;

  constructor(private readonly pageController: PageController) {}

  getLLMService(): LLMService {
    return (this.llmService ??= new LLMService());
  }

  getAnalyzer(): CodeAnalyzer {
    return (this.analyzer ??= new CodeAnalyzer(this.getLLMService()));
  }

  getSummarizer(): AISummarizer {
    return (this.summarizer ??= new AISummarizer(this.getLLMService()));
  }

  getDeobfuscator(): Deobfuscator {
    return (this.deobfuscator ??= new Deobfuscator(this.getLLMService()));
  }

  getCryptoDetector(): CryptoDetector {
    return (this.cryptoDetector ??= new CryptoDetector(this.getLLMService()));
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
}
