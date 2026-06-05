/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {bypassDebugger} from './bypassDebugger.js';
export {antiAntiDebug} from './antiAntiDebug.js';
export type {
  HookResult,
  BypassTarget,
  AntiAntiDebugFeature,
  Frame,
} from './types.js';
export {
  ANTI_ANTI_DEBUG_TOOLTYPE,
  BYPASS_DEBUGGER_TOOLTYPE,
  antiAntiDebugFeatureSchema,
  bypassTargetSchema,
  DEFAULT_BYPASS_TARGETS,
} from './schema.js';
export {buildAntiAntiDebugScript, buildBypassDebuggerScript} from './hooks.js';
export {runHook} from './result.js';
