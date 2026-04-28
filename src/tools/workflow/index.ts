/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {autoHook} from './autoHook.js';
export {observeFlow} from './observeFlow.js';
export {rebuildBundle} from './rebuildBundle.js';
export {traceSignatureGeneration} from './traceSignatureGeneration.js';
export type {
  AutoHookOptions,
  AutoHookToolData,
  AutoHookToolResult,
  CryptoDetectionResult,
  HookInjectionRecord,
} from './autoHook.js';
export type {
  DependencyInfo,
  ObserveFlowOptions,
  ObserveFlowReport,
  ObserveFlowToolResult,
  ScriptAnalysis,
} from './observeFlow.js';
export type {
  RebuildBundleOptions,
  RebuildBundleToolResult,
} from './rebuildBundle.js';
export type {TraceSignatureGenerationParams} from './traceSignatureGeneration.js';
