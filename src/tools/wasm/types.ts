/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  WasmAnalysisResult,
  WasmDecompileResult,
  WasmRuntimeEvent,
} from '../../modules/wasm/WasmTypes.js';
import type {MessagesResult} from '../shared/types.js';

// ─── 基础结果类型 ────────────────────────────────────

export interface WasmToolResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

// ─── 数据类型 ──────────────────────────────────────────

export interface NativeToolInfo {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
}

export interface WasmCapabilitiesData {
  wabt: NativeToolInfo;
  binaryen: NativeToolInfo;
  wasmtime: NativeToolInfo;
  wasmer: NativeToolInfo;
  capturedModules: number;
  runtimeEvents: number;
}

export interface WasmDumpData {
  moduleId: string;
  hash: string;
  size: number;
  outputPath: string;
  sourceUrl?: string;
}

export interface WasmDisassembleData {
  inputPath: string;
  outputPath?: string;
  decompiled: WasmDecompileResult;
}

export interface WasmDecompileData {
  inputPath: string;
  outputPath?: string;
  decompiled: WasmDecompileResult;
}

export interface WasmInspectSectionsData {
  inputPath: string;
  analysis: Omit<WasmAnalysisResult, 'moduleId' | 'hash' | 'size'>;
}

export interface WasmOfflineRunData {
  inputPath: string;
  functionName: string;
  runtime: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface WasmOptimizeData {
  inputPath: string;
  outputPath: string;
  level: string;
  originalSize: number;
  optimizedSize: number;
  reduction: number;
  stdout: string;
  stderr: string;
}

export interface WasmVmpTraceData {
  totalEvents: number;
  filteredEvents: number;
  events: WasmRuntimeEvent[];
  modules: Array<{id: string; hash: string; size: number}>;
}

export interface WasmMemoryInspectData {
  offset: number;
  length: number;
  format: string;
  hex?: string;
  ascii?: string;
  searchResults?: Array<{offset: number; match: string}>;
}

// ─── 结果类型 ──────────────────────────────────────────

export type WasmCapabilitiesResult = WasmToolResult<WasmCapabilitiesData>;
export type WasmDumpResult = WasmToolResult<WasmDumpData>;
export type WasmDisassembleResult = WasmToolResult<WasmDisassembleData>;
export type WasmDecompileResult_ = WasmToolResult<WasmDecompileData>;
export type WasmInspectSectionsResult = WasmToolResult<WasmInspectSectionsData>;
export type WasmOfflineRunResult = WasmToolResult<WasmOfflineRunData>;
export type WasmOptimizeResult = WasmToolResult<WasmOptimizeData>;
export type WasmVmpTraceResult = WasmToolResult<WasmVmpTraceData>;
export type WasmMemoryInspectResult = WasmToolResult<WasmMemoryInspectData>;
