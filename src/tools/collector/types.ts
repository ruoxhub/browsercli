/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CodeCollector} from '../../modules/collector/CodeCollector.js';
import type {MessagesResult} from '../shared/types.js';

/**
 * Collector 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface CollectorResult extends MessagesResult {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 收集代码的智能模式 */
export type SmartMode = 'summary' | 'priority' | 'incremental' | 'full';

/** 返回模式 */
export type ReturnMode = 'full' | 'summary' | 'pattern' | 'top-priority';

/** 文件类型 */
export type ScriptType =
  | 'inline'
  | 'external'
  | 'dynamic'
  | 'service-worker'
  | 'web-worker';

/** collectCode 参数 */
export interface CollectCodeParams {
  url: string;
  smartMode?: SmartMode;
  returnMode?: ReturnMode;
  includeInline?: boolean;
  includeExternal?: boolean;
  includeDynamic?: boolean;
  maxTotalSize?: number;
  maxFileSize?: number;
  pattern?: string;
  limit?: number;
  topN?: number;
}

/** 文件摘要条目 */
export interface FileSummaryEntry {
  url: string;
  size: number;
  type: string;
  truncated?: boolean;
  originalSize?: number;
}

/** Diff 变更条目 */
export interface DiffChangedEntry {
  url: string;
  type: string;
  previousSize: number;
  currentSize: number;
  delta: number;
}

/** collectionDiff 结果 */
export interface CollectionDiffData {
  previousCount: number;
  currentCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  added: FileSummaryEntry[];
  removed: FileSummaryEntry[];
  changed: DiffChangedEntry[];
  unchanged?: FileSummaryEntry[];
}

/** collectionDiff 参数 */
export interface CollectionDiffParams {
  previous: FileSummaryEntry[];
  current?: FileSummaryEntry[];
  includeUnchanged?: boolean;
}

/** searchInScripts 参数 */
export interface SearchInScriptsParams {
  pattern: string;
  limit?: number;
  maxTotalSize?: number;
}

/** searchInScripts 结果数据 */
export interface SearchInScriptsData {
  files: Array<{
    url: string;
    content: string;
    size: number;
    type: string;
    /** 若为 combo URL，列出其内含的子文件路径 */
    subFiles?: string[];
    /** 若为 combo URL 且 pattern 命中某些子文件名，列出命中的子文件 */
    matchedSubFiles?: string[];
  }>;
  totalSize: number;
  matched: number;
  returned: number;
  truncated: boolean;
}

/** collectCode 返回数据结构 */
export interface CollectCodeData {
  /** 收集的文件列表或摘要 */
  files?: Array<{url: string; content?: string; size: number; type: string}>;
  /** 文件摘要信息 (summary 模式) */
  summary?: FileSummaryEntry[];
  /** 总大小 (字节) */
  totalSize?: number;
  /** 收集的文件数量 */
  count?: number;
  /** 是否被截断 */
  truncated?: boolean;
  /** 返回模式 */
  returnMode?: ReturnMode;
}

/** collectCode 返回结果 */
export interface CollectCodeResult extends CollectorResult {
  tooltype: 'collect_code';
  data: CollectCodeData | null;
  suggestion?: string;
}

/** collectionDiff 返回结果 */
export interface CollectionDiffResult extends CollectorResult {
  tooltype: 'collection_diff';
  data: CollectionDiffData;
}

/** searchInScripts 返回结果 */
export interface SearchInScriptsResult extends CollectorResult {
  tooltype: 'search_in_scripts';
  data: SearchInScriptsData;
  suggestion?: string;
}

/** Collector 运行时服务（依赖注入） */
export interface CollectorRuntimeServices {
  collector: CodeCollector;
}
