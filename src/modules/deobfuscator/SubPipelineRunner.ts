/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 子管线调度器
 *
 * 封装对各子模块（Packer、JSVMP、Advanced、ASTOptimizer、webcrack）的调用，
 * 统一处理 try/catch、Transformation 记录和 warnings 收集。
 * 这些函数是主 Deobfuscator 管线的"适配器"层。
 */

import type {
  AdvancedDeobfuscateOptions,
  AdvancedDeobfuscator,
} from './AdvancedDeobfuscator.js';
import type {ASTOptimizer} from './ASTOptimizer.js';
import type {JSVMPDeobfuscator} from './JSVMPDeobfuscator.js';
import type {UniversalUnpacker} from './PackerDeobfuscator.js';
import type {Transformation, UnresolvedPart} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {runWebcrack, type WebcrackExecutionResult} from './webcrack.js';
import type {DeobfuscateFullOptions} from './Deobfuscator.js';

/**
 * Packer / AAEncode / URLEncode 解包
 */
export async function runUnpack(
  unpacker: UniversalUnpacker,
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    logger.info('Running UniversalUnpacker...');
    const result = await unpacker.deobfuscate(code);
    if (result.success && result.code !== code) {
      transformations.push({
        type: 'unpack',
        description: `Unpacked ${result.type} obfuscation`,
        success: true,
      });
      return result.code;
    }
  } catch (error) {
    logger.warn('UniversalUnpacker failed', error);
    transformations.push({
      type: 'unpack',
      description: 'UniversalUnpacker failed',
      success: false,
    });
  }
  return code;
}

/**
 * JSVMP 虚拟机保护还原
 * warnings/unresolvedParts 完整透传给外部 AI
 */
export async function runJSVMP(
  deobfuscator: JSVMPDeobfuscator,
  code: string,
  options: DeobfuscateFullOptions,
  transformations: Transformation[],
  pipelineWarnings: string[],
  pipelineUnresolved: UnresolvedPart[],
): Promise<string> {
  try {
    logger.info('Running JSVMPDeobfuscator...');
    const result = await deobfuscator.deobfuscate({
      code,
      aggressive: options.aggressiveVM ?? options.aggressive ?? false,
      extractInstructions: true,
      timeout: options.timeout ?? 30000,
    });

    if (result.warnings && result.warnings.length > 0) {
      pipelineWarnings.push(...result.warnings.map(w => `[JSVMP] ${w}`));
    }
    if (result.unresolvedParts && result.unresolvedParts.length > 0) {
      pipelineUnresolved.push(...result.unresolvedParts);
    }

    if (result.isJSVMP && result.confidence > 0.3) {
      const detail: Record<string, unknown> = {
        vmType: result.vmType,
        confidence: result.confidence,
        warningCount: result.warnings?.length ?? 0,
        unresolvedCount: result.unresolvedParts?.length ?? 0,
      };

      if (result.vmFeatures) {
        detail.vmFeatures = {
          instructionCount: result.vmFeatures.instructionCount,
          complexity: result.vmFeatures.complexity,
          hasSwitch: result.vmFeatures.hasSwitch,
          hasInstructionArray: result.vmFeatures.hasInstructionArray,
          hasProgramCounter: result.vmFeatures.hasProgramCounter,
          interpreterLocation: result.vmFeatures.interpreterLocation,
        };
      }

      if (result.instructions && result.instructions.length > 0) {
        detail.instructionSample = result.instructions
          .slice(0, 10)
          .map(i => ({type: i.type, opcode: i.opcode}));
      }

      if (result.stats) detail.stats = result.stats;

      transformations.push({
        type: 'jsvmp',
        description: `JSVMP deobfuscation (type: ${result.vmType ?? 'unknown'}, confidence: ${(result.confidence * 100).toFixed(1)}%)`,
        success: true,
        detail,
      });

      return result.deobfuscatedCode;
    } else if (result.isJSVMP) {
      pipelineWarnings.push(
        `[JSVMP] 检测到VM保护但还原置信度过低(${(result.confidence * 100).toFixed(1)}%)，代码未修改`,
      );
      transformations.push({
        type: 'jsvmp',
        description: `JSVMP detected but confidence too low (${(result.confidence * 100).toFixed(1)}%), code unchanged`,
        success: false,
        detail: {
          vmType: result.vmType,
          confidence: result.confidence,
          reason: 'confidence_too_low',
        },
      });
    }
  } catch (error) {
    logger.warn('JSVMPDeobfuscator failed', error);
    pipelineWarnings.push(`[JSVMP] 反混淆失败: ${error}`);
    transformations.push({
      type: 'jsvmp',
      description: `JSVMP deobfuscation failed: ${error}`,
      success: false,
    });
  }
  return code;
}

/**
 * 高级反混淆管线
 */
export async function runAdvanced(
  deobfuscator: AdvancedDeobfuscator,
  code: string,
  options: DeobfuscateFullOptions,
  transformations: Transformation[],
  pipelineWarnings: string[],
): Promise<string> {
  try {
    logger.info('Running AdvancedDeobfuscator...');
    const advOptions: AdvancedDeobfuscateOptions = {
      code,
      aggressiveVM: options.aggressiveVM,
      useASTOptimization: false,
      timeout: options.timeout,
    };

    const result = await deobfuscator.deobfuscate(advOptions);

    if (result.warnings && result.warnings.length > 0) {
      pipelineWarnings.push(...result.warnings.map(w => `[Advanced] ${w}`));
    }

    if (result.detectedTechniques.length > 0) {
      transformations.push({
        type: 'advanced',
        description: `Advanced deobfuscation applied: ${result.detectedTechniques.join(', ')} (confidence: ${(result.confidence * 100).toFixed(1)}%)`,
        success: true,
        detail: {
          detectedTechniques: result.detectedTechniques,
          confidence: result.confidence,
        },
      });
      return result.code;
    }
  } catch (error) {
    logger.warn('AdvancedDeobfuscator failed', error);
    pipelineWarnings.push(`[Advanced] 高级反混淆失败: ${error}`);
    transformations.push({
      type: 'advanced',
      description: `Advanced deobfuscation failed: ${error}`,
      success: false,
    });
  }
  return code;
}

/**
 * AST 优化器
 */
export async function runASTOptimizer(
  optimizer: ASTOptimizer,
  code: string,
  transformations: Transformation[],
): Promise<string> {
  try {
    logger.info('Running ASTOptimizer...');
    const optimized = optimizer.optimize(code);
    if (optimized !== code) {
      transformations.push({
        type: 'ast-optimize',
        description:
          'AST optimizations applied (constant folding, propagation, variable inlining, property unfolding)',
        success: true,
      });
      return optimized;
    }
  } catch (error) {
    logger.warn('ASTOptimizer failed', error);
    transformations.push({
      type: 'ast-optimize',
      description: 'AST optimization failed',
      success: false,
    });
  }
  return code;
}

/**
 * webcrack 前置策略
 */
export async function runWebcrackStep(
  code: string,
  options: DeobfuscateFullOptions,
  transformations: Transformation[],
  pipelineWarnings: string[],
): Promise<WebcrackExecutionResult> {
  try {
    logger.info('Running webcrack...');
    const result = await runWebcrack(code, {
      unpack: options.unpack,
      unminify: options.unminify,
      jsx: options.jsx,
      mangle: options.mangle ?? options.renameVariables,
      mappings: options.mappings,
      outputDir: options.outputDir,
      forceOutput: options.forceOutput,
      includeModuleCode: options.includeModuleCode,
      maxBundleModules: options.maxBundleModules,
    });

    if (!result.applied) {
      if (result.reason) {
        pipelineWarnings.push(`[webcrack] ${result.reason}`);
      }
      transformations.push({
        type: 'webcrack',
        description: `webcrack skipped: ${result.reason ?? 'unknown reason'}`,
        success: false,
      });
      return result;
    }

    const detail: Record<string, unknown> = {
      optionsUsed: result.optionsUsed,
    };
    if (result.bundle) {
      detail.bundle = {
        type: result.bundle.type,
        moduleCount: result.bundle.moduleCount,
        truncated: result.bundle.truncated,
        mappingsApplied: result.bundle.mappingsApplied,
      };
    }
    if (result.savedTo) detail.savedTo = result.savedTo;

    transformations.push({
      type: 'webcrack',
      description:
        `webcrack applied (unpack=${result.optionsUsed.unpack}, ` +
        `unminify=${result.optionsUsed.unminify}, ` +
        `jsx=${result.optionsUsed.jsx}, mangle=${result.optionsUsed.mangle})` +
        (result.bundle
          ? ` — recovered ${result.bundle.moduleCount} modules`
          : ''),
      success: true,
      detail,
    });

    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('webcrack pipeline error', error);
    pipelineWarnings.push(`[webcrack] ${reason}`);
    transformations.push({
      type: 'webcrack',
      description: `webcrack pipeline error: ${reason}`,
      success: false,
    });
    return {
      applied: false,
      code,
      optionsUsed: {jsx: true, mangle: false, unminify: true, unpack: true},
      reason,
    };
  }
}

/**
 * 增强 AST Pass 运行器
 */
export async function runEnhancedPass(
  passName: string,
  passFn: (ast: import('@babel/types').File) => {ast: import('@babel/types').File; changed: boolean},
  code: string,
  transformations: Transformation[],
  options?: {maxIterations?: number; timeoutMs?: number},
): Promise<string> {
  try {
    const {AstPassRunner} = await import('./AstPassRunner.js');
    const result = AstPassRunner.run(code, passFn, options);
    if (result.changed) {
      transformations.push({
        type: `enhanced-${passName}`,
        description: `${passName} applied (${result.iterations} iterations)`,
        success: true,
        detail: {iterations: result.iterations},
      });
      return result.code;
    }
  } catch (error) {
    logger.warn(`Enhanced pass ${passName} failed`, error);
    transformations.push({
      type: `enhanced-${passName}`,
      description: `${passName} failed: ${error}`,
      success: false,
    });
  }
  return code;
}

/**
 * 站点适配器运行器
 */
export async function runSiteAdapter(
  adapter: import('./SiteAdapterRegistry.js').SiteAdapter,
  phase: 'pre' | 'post',
  code: string,
  transformations: Transformation[],
): Promise<string> {
  const passes = phase === 'pre' ? adapter.prePasses : adapter.postPasses;
  if (!passes || passes.length === 0) {
    return code;
  }

  let currentCode = code;
  for (const passFn of passes) {
    currentCode = await runEnhancedPass(
      `site-${adapter.patternId}-${phase}`,
      passFn,
      currentCode,
      transformations,
      {timeoutMs: 60000},
    );
  }
  return currentCode;
}
