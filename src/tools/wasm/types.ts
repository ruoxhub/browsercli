/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  WasmAnalysisResult,
  WasmBoundaryChain,
  WasmDecompileResult,
  WasmModuleRecord,
  WasmRuntimeEvent,
  WasmSignatureDiffResult,
} from '../../modules/wasm/WasmTypes.js';

// ─── 基础结果类型 ────────────────────────────────────

export interface WasmToolResult<T = unknown> {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat?: string;
  data?: T;
}

// ─── 参数类型 ──────────────────────────────────────────

export interface WasmCapabilitiesParams {}

export interface WasmDumpParams {
  moduleIndex?: number;
  outputPath?: string;
}

export interface WasmDisassembleParams {
  inputPath: string;
  outputPath?: string;
  foldExprs?: boolean;
}

export interface WasmDecompileParams {
  inputPath: string;
  outputPath?: string;
}

export interface WasmInspectSectionsParams {
  inputPath: string;
  sections?: 'headers' | 'details' | 'disassemble' | 'all';
}

export interface WasmOfflineRunParams {
  inputPath: string;
  functionName: string;
  args?: string[];
  runtime?: 'wasmtime' | 'wasmer' | 'auto';
  timeoutMs?: number;
}

export interface WasmOptimizeParams {
  inputPath: string;
  outputPath?: string;
  level?: 'O1' | 'O2' | 'O3' | 'O4' | 'Os' | 'Oz';
}

export interface WasmVmpTraceParams {
  maxEvents?: number;
  filterModule?: string;
}

export interface WasmMemoryInspectParams {
  offset?: number;
  length?: number;
  format?: 'hex' | 'ascii' | 'both';
  searchPattern?: string;
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
