/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 反混淆模块公共导出
 */

// 主管线
export {Deobfuscator} from './Deobfuscator.js';
export type {DeobfuscateFullOptions} from './Deobfuscator.js';

// 子模块
export {AdvancedDeobfuscator} from './AdvancedDeobfuscator.js';
export type {
  AdvancedDeobfuscateOptions,
  AdvancedDeobfuscateResult,
} from './AdvancedDeobfuscator.js';

export {JSVMPDeobfuscator} from './JSVMPDeobfuscator.js';

export {ASTOptimizer} from './ASTOptimizer.js';

export {
  PackerDeobfuscator,
  AAEncodeDeobfuscator,
  URLEncodeDeobfuscator,
  UniversalUnpacker,
} from './PackerDeobfuscator.js';
export type {
  PackerDeobfuscatorOptions,
  PackerDeobfuscatorResult,
} from './PackerDeobfuscator.js';

// 增强基础设施
export {AstPassRunner} from './AstPassRunner.js';
export type {AstPassResult, AstPassOptions} from './AstPassRunner.js';
export {StaticResolver, UNRESOLVED} from './StaticResolver.js';
export {SandboxEvaluator} from './SandboxEvaluator.js';
export type {SandboxOptions, PreludeResult, EvalResult} from './SandboxEvaluator.js';
export {WrapperFolder} from './WrapperFolder.js';
export type {WrapperDescriptor, WrapperFolderOptions} from './WrapperFolder.js';

// 增强 AST Pass
export {normalizeStructure} from './NormalizeStructurePass.js';
export {pruneFakeBranches} from './PruneFakeBranchesPass.js';
export {inlineLiterals} from './InlineLiteralsPass.js';
export {enhancedControlFlow} from './EnhancedControlFlowPass.js';
export {ifChainToSwitch} from './IfChainToSwitchPass.js';

// 站点适配器
export {SiteAdapterRegistry} from './SiteAdapterRegistry.js';
export type {SitePattern, SiteAdapter} from './SiteAdapterRegistry.js';

// 质量度量
export {ResidueMetrics} from './ResidueMetrics.js';
export type {ResidueMetricsResult} from './ResidueMetrics.js';

// BabelPack 增强
export {
  keyToLiteral,
  varDeclarToFuncDeclar,
  declaratorToDeclaration,
  deleteRepeatDefine,
  preDecodeObject,
  decodeObject,
  deleteObfuscatorCode,
  callExpressToLiteral,
  structuralEnhance,
  objectDecode,
  cleanupObfuscator,
} from './BabelPackEnhancer.js';
