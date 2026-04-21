/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── v-jstools 纯函数 ─────────────────────────────────

export {deobfuscateCode, minifyCodeFn, transpileCode, analyzeAst, diffCodeFn, formatBytes} from './deobfuscate.js';

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
