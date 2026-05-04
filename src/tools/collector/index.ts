/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Collector 工具集（标准 MCP 工具版本）。
 *
 * 所有工具均使用 defineTool 包裹，符合项目工具定义规范，
 * 通过 MCP 框架调用，handler 通过 response 对象返回结果。
 */

export {collectCode} from './collectCode.js';
export {collectionDiff} from './collectionDiff.js';
export {searchInScripts} from './searchInScripts.js';
export type {
  CollectorResult,
  SmartMode,
  ReturnMode,
  ScriptType,
  CollectCodeParams,
  FileSummaryEntry,
  DiffChangedEntry,
  CollectionDiffData,
  CollectionDiffParams,
  SearchInScriptsParams,
  SearchInScriptsData,
  CollectCodeResult,
  CollectionDiffResult,
  SearchInScriptsResult,
  CollectorRuntimeServices,
} from './types.js';
