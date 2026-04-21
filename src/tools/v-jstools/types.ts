/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** v-jstools 操作统一返回结构 */
export interface VJstoolsResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat?: string;
}

/** 解混淆参数 */
export interface DeobfuscateParams {
  code: string;
  mode?: 'auto' | 'sojson' | 'ob' | 'general' | 'jsfuck';
  clearExtra?: boolean;
  clearUnused?: boolean;
}

/** 解混淆结果 */
export interface DeobfuscateResult extends VJstoolsResult {
  tooltype: 'deobfuscate_code_vj';
  result: string;
  origLines: number;
  resultLines: number;
  origBytes: number;
  resultBytes: number;
}

/** 压缩/格式化参数 */
export interface MinifyParams {
  code: string;
  action?: 'minify' | 'format';
}

/** 压缩/格式化结果 */
export interface MinifyResult extends VJstoolsResult {
  tooltype: 'minify_code';
  result: string;
  origBytes: number;
  resultBytes: number;
  reduction: string;
}

/** 转译参数 */
export interface TranspileParams {
  code: string;
  presets?: string[];
}

/** 转译结果 */
export interface TranspileResult extends VJstoolsResult {
  tooltype: 'transpile_code';
  result: string;
}

/** AST 分析参数 */
export interface AnalyzeAstParams {
  code: string;
  detail?: 'summary' | 'full';
  filterType?: string;
}

/** AST 分析结果 */
export interface AnalyzeAstResult extends VJstoolsResult {
  tooltype: 'analyze_ast';
  /** summary 模式下的统计数据 */
  stats?: Record<string, number>;
  /** 唯一标识符 */
  identifiers?: string[];
  /** 函数列表 */
  functions?: Array<{name: string; line: number}>;
  /** full 模式下的完整 AST JSON */
  fullAst?: string;
  /** filterType 模式下的节点列表 */
  filteredNodes?: Array<{type: string; line: number; name?: string}>;
}

/** 代码对比参数 */
export interface DiffParams {
  text1: string;
  text2: string;
  mode?: 'unified' | 'context';
}

/** 代码对比结果 */
export interface DiffResult extends VJstoolsResult {
  tooltype: 'diff_code';
  diff: string;
  addedLines: number;
  removedLines: number;
}
