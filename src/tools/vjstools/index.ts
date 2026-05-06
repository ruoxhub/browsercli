/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── v-jstools defineTool 工具 ──────────────────────────

export {
  deobfuscateCodeVj,
  minifyCode,
  transpileCodeTool,
  analyzeAstTool,
  diffCodeTool,
  formatBytes,
} from './deobfuscate.js';

// ─── 纯函数导出（内部复用） ─────────────────────────────

export {
  deobfuscateCode,
  minifyCodeFn,
  transpileCode,
  analyzeAst,
  diffCodeFn,
} from './deobfuscate.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  VJstoolsResult,
  DeobfuscateParams,
  DeobfuscateResult,
  MinifyParams,
  MinifyResult,
  TranspileParams,
  TranspileResult,
  AnalyzeAstParams,
  AnalyzeAstResult,
  DiffParams,
  DiffResult,
} from './types.js';
