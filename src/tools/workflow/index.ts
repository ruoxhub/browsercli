/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {autoHook} from './autoHook.js';
export {observeFlow} from './observeFlow.js';
export {rebuildBundle} from './rebuildBundle.js';
export {traceSignatureGeneration} from './traceSignatureGeneration.js';
export {recommendNextStepTool, explainReverseStage} from './advisor.js';
export {
  listParameterWorkflowsTool,
  getParameterWorkflowTool,
  recommendParameterWorkflowTool,
} from './parameterWorkflows.js';
export type {
  AutoHookOptions,
  AutoHookToolData,
  AutoHookToolResult,
  CryptoDetectionResult,
  HookInjectionRecord,
} from './autoHook.js';
export type {
  DependencyInfo,
  ScriptAnalysis,
} from './observeFlow.js';
export type {
  RebuildBundleOptions,
  RebuildBundleToolResult,
} from './rebuildBundle.js';


