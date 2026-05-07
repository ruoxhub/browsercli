/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {MessagesResult} from '../shared/types.js';

/** v-jstools 操作统一返回结构（兼容旧字段 logFormat） */
export interface VJstoolsResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 解混淆参数 */
export interface DeobfuscateParams {
  code: string;
  mode?: 'auto' | 'sojson' | 'ob' | 'general' | 'jsfuck';
  clearExtra?: boolean;
  clearUnused?: boolean;
}

/** 解混淆返回数据 */
export interface DeobfuscateData {
  result: string;
  origLines: number;
  resultLines: number;
  origBytes: number;
  resultBytes: number;
}

/** 解混淆结果 */
export interface DeobfuscateResult extends VJstoolsResult<DeobfuscateData> {
  tooltype: 'deobfuscate_code_vj';
}

/** 压缩/格式化参数 */
export interface MinifyParams {
  code: string;
  action?: 'minify' | 'format';
}

/** 压缩/格式化返回数据 */
export interface MinifyData {
  result: string;
  origBytes: number;
  resultBytes: number;
  reduction: string;
}

/** 压缩/格式化结果 */
export interface MinifyResult extends VJstoolsResult<MinifyData> {
  tooltype: 'minify_code';
}

/** 转译参数 */
export interface TranspileParams {
  code: string;
  presets?: string[];
}

/** 转译返回数据 */
export interface TranspileData {
  result: string;
}

/** 转译结果 */
export interface TranspileResult extends VJstoolsResult<TranspileData> {
  tooltype: 'transpile_code';
}

/** AST 分析参数 */
export interface AnalyzeAstParams {
  code: string;
  detail?: 'summary' | 'full';
  filterType?: string;
}

/** AST 分析返回数据 */
export interface AnalyzeAstData {
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

/** AST 分析结果 */
export interface AnalyzeAstResult extends VJstoolsResult<AnalyzeAstData> {
  tooltype: 'analyze_ast';
}

/** 代码对比参数 */
export interface DiffParams {
  text1: string;
  text2: string;
  mode?: 'unified' | 'context';
}

/** 代码对比返回数据 */
export interface DiffData {
  diff: string;
  addedLines: number;
  removedLines: number;
}

/** 代码对比结果 */
export interface DiffResult extends VJstoolsResult<DiffData> {
  tooltype: 'diff_code';
}
