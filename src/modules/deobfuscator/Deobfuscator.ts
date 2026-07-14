/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 反混淆主管线（编排门面）
 *
 * 统一调度所有反混淆子模块，按检测结果自动选择最优管线：
 *   1. PackerDeobfuscator  — Packer / AAEncode / URLEncode 解包
 *   2. JSVMPDeobfuscator   — JSVMP 虚拟机保护还原
 *   3. AdvancedDeobfuscator — 高级混淆 (invisible-unicode, 控制流平坦化, 不透明谓词, 死代码…)
 *   4. ASTOptimizer         — 通用 AST 优化 (常量折叠/传播, 变量内联, 序列展开…)
 *   5. 策略模块             — StringDecryptionStrategy / ControlFlowStrategy / CodeCleanupStrategy
 *   6. LLM 辅助分析        — 可选，利用 AI 做语义分析
 *
 * 设计原则：
 *   - 每个子管线独立 try/catch，单步失败不中断整体
 *   - 检测优先，只对检测到的混淆类型执行对应管线
 *   - 管线顺序固定：先解包 → 再深度还原 → 再 AST 优化 → 最后基础清理
 *   - 结果缓存 + LRU 淘汰
 *
 * 具体策略实现已拆分到独立模块：
 *   - StringDecryptionStrategy.ts — 字符串数组提取/替换、解码器内联、VM 沙箱求值
 *   - ControlFlowStrategy.ts      — 控制流平坦化还原
 *   - CodeCleanupStrategy.ts      — 常量折叠、死代码消除、表达式简化、变量重命名
 *   - ObfuscationDetector.ts      — 混淆类型检测与合并
 *   - SubPipelineRunner.ts        — 子模块调用适配器（Packer/JSVMP/Advanced/AST/webcrack）
 */

import crypto from 'node:crypto';

import type {LLMService} from '../../services/LLMService.js';
import type {
  DeobfuscateBundleSummary,
  DeobfuscateOptions,
  DeobfuscateResult,
  DeobfuscateSavedArtifact,
  ObfuscationType,
  Transformation,
  UnresolvedPart,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

// 子模块
import {AdvancedDeobfuscator} from './AdvancedDeobfuscator.js';
import {ASTOptimizer} from './ASTOptimizer.js';
import {
  structuralEnhance,
  objectDecode,
  cleanupObfuscator,
  callExpressToLiteral,
} from './BabelPackEnhancer.js';
import {
  basicTransform,
  renameVariables,
  simplifyExpressions,
} from './CodeCleanupStrategy.js';
import {unflattenControlFlow} from './ControlFlowStrategy.js';
import {enhancedControlFlow} from './EnhancedControlFlowPass.js';
import {ifChainToSwitch} from './IfChainToSwitchPass.js';
import {inlineLiterals} from './InlineLiteralsPass.js';
import {JSVMPDeobfuscator} from './JSVMPDeobfuscator.js';
import {normalizeStructure} from './NormalizeStructurePass.js';
import {
  detectObfuscationType,
  mergeObfuscationTypes,
} from './ObfuscationDetector.js';
import {UniversalUnpacker} from './PackerDeobfuscator.js';
import {pruneFakeBranches} from './PruneFakeBranchesPass.js';
import {SiteAdapterRegistry} from './SiteAdapterRegistry.js';
import {
  decodeStrings,
  decryptArrays,
  evaluateStringDecoderCalls,
  extractStringArrays,
  inlineStringDecoderCalls,
} from './StringDecryptionStrategy.js';
import {
  runAdvanced,
  runASTOptimizer,
  runEnhancedPass,
  runJSVMP,
  runSiteAdapter,
  runUnpack,
  runWebcrackStep,
} from './SubPipelineRunner.js';
import {WrapperFolder} from './WrapperFolder.js';

// ==================== 扩展选项 ====================

export interface DeobfuscateFullOptions extends DeobfuscateOptions {
  /** 启用高级反混淆管线（AdvancedDeobfuscator） */
  advanced?: boolean;
  /** 启用 JSVMP 专项反混淆 */
  jsvmp?: boolean;
  /** 启用 AST 优化器 */
  astOptimize?: boolean;
  /** 启用 Packer/AAEncode/URLEncode 自动解包 */
  unpack?: boolean;
  /** 激进 VM 反混淆 */
  aggressiveVM?: boolean;
  /** 超时(ms)，默认 60000 */
  timeout?: number;
  /** 自动模式：根据检测结果自动启用对应管线（默认 true） */
  auto?: boolean;
}

// ==================== 主类 ====================

export class Deobfuscator {
  private llm?: LLMService;

  // 子模块实例
  advancedDeobfuscator: AdvancedDeobfuscator;
  jsvmpDeobfuscator: JSVMPDeobfuscator;
  astOptimizer: ASTOptimizer;
  universalUnpacker: UniversalUnpacker;

  // 缓存
  stringArrays = new Map<string, string[]>();
  resultCache = new Map<string, DeobfuscateResult>();
  maxCacheSize = 100;

  constructor(llm?: LLMService) {
    this.llm = llm;
    this.advancedDeobfuscator = new AdvancedDeobfuscator(llm);
    this.jsvmpDeobfuscator = new JSVMPDeobfuscator(llm);
    this.astOptimizer = new ASTOptimizer();
    this.universalUnpacker = new UniversalUnpacker();
  }

  // ==================== 公共 API ====================

  /**
   * 完整反混淆管线入口
   */
  async deobfuscate(
    options: DeobfuscateFullOptions,
  ): Promise<DeobfuscateResult> {
    if (!options.code || options.code.trim() === '') {
      logger.warn('Deobfuscation called with empty code');
      throw new Error('No code provided for deobfuscation');
    }

    // 缓存
    const cacheKey = this.generateCacheKey(options);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.debug('Deobfuscation result from cache');
      return {...cached, cached: true};
    }

    logger.info('Starting deobfuscation pipeline...');
    const startTime = Date.now();

    const pipelineWarnings: string[] = [];
    const pipelineUnresolved: UnresolvedPart[] = [];
    let pipelineBundle: DeobfuscateBundleSummary | undefined;
    let pipelineSavedTo: string | undefined;
    let pipelineSavedArtifacts: DeobfuscateSavedArtifact[] | undefined;
    let webcrackApplied = false;

    try {
      let code = options.code;
      const transformations: Transformation[] = [];
      const autoMode = options.auto !== false;

      // ── Step 0: 检测混淆类型 ──
      const obfuscationType = detectObfuscationType(code);
      logger.info(`Detected obfuscation types: ${obfuscationType.join(', ')}`);
      pipelineWarnings.push(`检测到的混淆类型: ${obfuscationType.join(', ')}`);

      // ── Step 0.5: webcrack 前置 ──
      if (
        this.shouldRun(options.webcrack, autoMode, obfuscationType, [
          'webpack',
          'javascript-obfuscator',
          'uglify',
        ])
      ) {
        const wc = await runWebcrackStep(
          code,
          options,
          transformations,
          pipelineWarnings,
        );
        if (wc.applied) {
          code = wc.code;
          webcrackApplied = true;
          pipelineBundle = wc.bundle;
          pipelineSavedTo = wc.savedTo;
          pipelineSavedArtifacts = wc.savedArtifacts;
        }
      }

      // ── Step 1: Packer / AAEncode / URLEncode 自动解包 ──
      if (
        this.shouldRun(options.unpack, autoMode, obfuscationType, [
          'packer',
          'aaencode',
          'urlencoded',
          'eval-obfuscation',
        ])
      ) {
        code = await runUnpack(this.universalUnpacker, code, transformations);
      }

      // ── Step 2: JSVMP 虚拟机保护还原 ──
      if (
        this.shouldRun(options.jsvmp, autoMode, obfuscationType, [
          'vm-protection',
        ])
      ) {
        code = await runJSVMP(
          this.jsvmpDeobfuscator,
          code,
          options,
          transformations,
          pipelineWarnings,
          pipelineUnresolved,
        );
      }

      // ── Step 3: 高级反混淆 ──
      if (
        this.shouldRun(options.advanced, autoMode, obfuscationType, [
          'invisible-unicode',
          'control-flow-flattening',
          'string-array-rotation',
          'dead-code-injection',
          'opaque-predicates',
          'custom',
        ])
      ) {
        code = await runAdvanced(
          this.advancedDeobfuscator,
          code,
          options,
          transformations,
          pipelineWarnings,
        );
      }

      // ── Step 3.5: 站点适配器前置 pass ──
      const siteRegistry = new SiteAdapterRegistry();
      await registerAllAdapters(siteRegistry);
      const siteDetection = siteRegistry.detect(code, options.siteAdapter);
      const activeAdapter = siteRegistry.getAdapter(
        options.siteAdapter || siteDetection.bestId,
      );
      if (
        activeAdapter &&
        activeAdapter.prePasses &&
        activeAdapter.prePasses.length > 0
      ) {
        code = await runSiteAdapter(
          activeAdapter,
          'pre',
          code,
          transformations,
        );
      }

      // ── Step 4: 基础管线（增强版） ──
      const useEnhancedPasses =
        options.aggressive ||
        (activeAdapter && activeAdapter.patternId !== 'generic');

      code = await extractStringArrays(
        code,
        transformations,
        this.stringArrays,
      );
      code = await basicTransform(code, transformations);
      code = await decodeStrings(code, transformations);
      code = await decryptArrays(code, transformations, this.stringArrays);
      code = await inlineStringDecoderCalls(code, transformations);
      code = await evaluateStringDecoderCalls(code, transformations);

      // ─�� Step 4.1: BabelPack 增强 ──
      // 对象属性解码：合并分散属性 + 内联对象常量查询
      code = await runEnhancedPass(
        'object-decode',
        objectDecode,
        code,
        transformations,
      );
      // VM 沙箱 eval 解码器：执行混淆器自带解码函数批量还原
      code = await runEnhancedPass(
        'call-express-to-literal',
        callExpressToLiteral({vmTimeoutMs: 60000}),
        code,
        transformations,
        {timeoutMs: 60000},
      );

      if (useEnhancedPasses) {
        // 结构化增强：拆分多声明 / 函数提升 / key 规范化 / 删除冗余绑定
        code = await runEnhancedPass(
          'structural-enhance',
          structuralEnhance,
          code,
          transformations,
        );
        code = await runEnhancedPass(
          'normalize-structure',
          normalizeStructure,
          code,
          transformations,
        );

        code = await runEnhancedPass(
          'enhanced-control-flow',
          enhancedControlFlow,
          code,
          transformations,
          {timeoutMs: 180000},
        );
        code = await runEnhancedPass(
          'if-chain-to-switch',
          ifChainToSwitch,
          code,
          transformations,
        );
        code = await runEnhancedPass(
          'prune-fake-branches',
          pruneFakeBranches,
          code,
          transformations,
        );
      }

      const useSitePasses =
        activeAdapter && activeAdapter.patternId !== 'generic';
      if (useSitePasses) {
        code = await runEnhancedPass(
          'wrapper-folding',
          ast => {
            const folder = new WrapperFolder();
            const changed = folder.foldWrapperObjects(ast);
            return {ast, changed};
          },
          code,
          transformations,
        );
        code = await runEnhancedPass(
          'inline-literals',
          inlineLiterals,
          code,
          transformations,
        );
      }

      code = await basicTransform(code, transformations);
      code = await simplifyExpressions(code, transformations);

      // ── Step 5: AST 优化器 ──
      if (
        this.shouldRun(options.astOptimize, autoMode, obfuscationType, [
          'javascript-obfuscator',
          'uglify',
          'webpack',
        ])
      ) {
        code = await runASTOptimizer(this.astOptimizer, code, transformations);
      }

      // ── Step 5.5: 混淆器残留清理 ──
      code = await runEnhancedPass(
        'cleanup-obfuscator',
        cleanupObfuscator,
        code,
        transformations,
      );

      // ── Step 5.6: 站点适配器后置 pass ──
      if (
        activeAdapter &&
        activeAdapter.postPasses &&
        activeAdapter.postPasses.length > 0
      ) {
        code = await runSiteAdapter(
          activeAdapter,
          'post',
          code,
          transformations,
        );
      }

      // ── Step 6: 变量重命名 ──
      if (options.renameVariables) {
        code = await renameVariables(code, transformations);
      }

      // ── Step 7: LLM 辅助分析 ──
      let analysis = 'Deobfuscation pipeline completed.';
      if (this.llm && options.llm) {
        const llmResult = await this.llmAnalysis(code);
        if (llmResult) {
          analysis = llmResult;
          transformations.push({
            type: 'llm-analysis',
            description: 'AI-assisted code analysis completed',
            success: true,
          });
        }
      }

      // ── 结果 ──
      const deobfuscateTime = Date.now() - startTime;
      const readabilityScore = this.calculateReadabilityScore(code);
      const confidence = this.calculateConfidence(
        transformations,
        readabilityScore,
      );
      const finalTypes = mergeObfuscationTypes(
        obfuscationType,
        transformations,
      );

      logger.success(
        `Deobfuscation completed in ${deobfuscateTime}ms (confidence: ${(confidence * 100).toFixed(1)}%)`,
      );

      const otherTransforms = transformations.filter(
        t => t.type !== 'webcrack' && t.success,
      );
      let engine: 'legacy' | 'webcrack' | 'hybrid';
      if (webcrackApplied) {
        engine = otherTransforms.length > 0 ? 'hybrid' : 'webcrack';
      } else {
        engine = 'legacy';
      }

      const result: DeobfuscateResult = {
        code,
        readabilityScore,
        confidence,
        obfuscationType: finalTypes,
        transformations,
        analysis,
        warnings: pipelineWarnings.length > 0 ? pipelineWarnings : undefined,
        unresolvedParts:
          pipelineUnresolved.length > 0 ? pipelineUnresolved : undefined,
        bundle: pipelineBundle,
        savedTo: pipelineSavedTo,
        savedArtifacts: pipelineSavedArtifacts,
        engine,
        webcrackApplied,
        cached: false,
      };

      this.cacheResult(cacheKey, result);
      return result;
    } catch (error) {
      logger.error('Deobfuscation failed', error);
      throw error;
    }
  }

  // ==================== 内部工具 ====================

  private shouldRun(
    explicitFlag: boolean | undefined,
    autoMode: boolean,
    detected: ObfuscationType[],
    triggers: ObfuscationType[],
  ): boolean {
    if (explicitFlag === false) return false;
    if (explicitFlag === true) return true;
    if (autoMode) {
      return detected.some(t => triggers.includes(t));
    }
    return false;
  }

  private async llmAnalysis(code: string): Promise<string | null> {
    if (!this.llm) return null;
    try {
      const messages = this.llm.generateDeobfuscationPrompt(code);
      const response = await this.llm.chat(messages, {
        temperature: 0.3,
        maxTokens: 2000,
      });
      return response.content;
    } catch (error) {
      logger.warn('LLM analysis failed', error);
      return null;
    }
  }

  private calculateConfidence(
    transformations: Transformation[],
    readabilityScore: number,
  ): number {
    const successCount = transformations.filter(t => t.success).length;
    const totalCount = transformations.length || 1;
    const transformConfidence = successCount / totalCount;
    const readabilityConfidence = readabilityScore / 100;
    return Math.min(
      Math.max(transformConfidence * 0.6 + readabilityConfidence * 0.4, 0),
      1,
    );
  }

  private calculateReadabilityScore(code: string): number {
    let score = 0;
    if (code.includes('\n')) score += 20;
    if (code.includes('//') || code.includes('/*')) score += 10;

    const varNames: string[] =
      code.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? [];
    const totalNameLength = varNames.reduce(
      (sum, name) => sum + name.length,
      0,
    );
    const avgLength = totalNameLength / (varNames.length || 1);
    if (avgLength > 3) score += 30;

    const density = code.replace(/\s/g, '').length / (code.length || 1);
    if (density < 0.8) score += 20;
    if (!code.includes('_0x') && !code.includes('\\x')) score += 20;
    return Math.min(score, 100);
  }

  private generateCacheKey(options: DeobfuscateFullOptions): string {
    const key = JSON.stringify({
      code: options.code.substring(0, 1000),
      aggressive: options.aggressive,
      advanced: options.advanced,
      jsvmp: options.jsvmp,
      astOptimize: options.astOptimize,
      unpack: options.unpack,
      auto: options.auto,
      webcrack: options.webcrack,
      unminify: options.unminify,
      jsx: options.jsx,
      mangle: options.mangle,
      includeModuleCode: options.includeModuleCode,
      maxBundleModules: options.maxBundleModules,
      outputDir: options.outputDir,
      forceOutput: options.forceOutput,
      mappingsCount: options.mappings?.length ?? 0,
    });
    return crypto.createHash('md5').update(key).digest('hex');
  }

  cacheResult(key: string, result: DeobfuscateResult): void {
    if (this.resultCache.size >= this.maxCacheSize) {
      const firstKey = this.resultCache.keys().next().value;
      if (firstKey) this.resultCache.delete(firstKey);
    }
    this.resultCache.set(key, result);
  }

  clearCache(): void {
    this.resultCache.clear();
    this.stringArrays.clear();
  }
}

async function registerAllAdapters(
  registry: SiteAdapterRegistry,
): Promise<void> {
  const adapterModules = [
    './adapters/Reese84Adapter.js',
    './adapters/DingxiangAdapter.js',
    './adapters/Geetest4Adapter.js',
    './adapters/TonghuashunAdapter.js',
    './adapters/YidunAdapter.js',
    './adapters/XiaohongshuAdapter.js',
    './adapters/ObVariantAdapter.js',
  ];

  for (const modulePath of adapterModules) {
    try {
      const mod = await import(modulePath);
      const AdapterClass = Object.values(mod).find(
        v =>
          typeof v === 'function' && v.prototype && 'patternId' in v.prototype,
      ) as
        | (new () => import('./SiteAdapterRegistry.js').SiteAdapter)
        | undefined;
      if (AdapterClass) {
        registry.register(new AdapterClass());
      }
      // ObVariant also registers mps-ob variant
      if (mod.MPS_OB_PATTERN_ID && AdapterClass) {
        const mpsAdapter = new AdapterClass();
        (mpsAdapter as {patternId: string}).patternId = mod.MPS_OB_PATTERN_ID;
        registry.register(mpsAdapter);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') {
        logger.warn(`Failed to load adapter ${modulePath}`, err);
      }
    }
  }
}
