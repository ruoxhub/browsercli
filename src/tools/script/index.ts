/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Script 执行与预加载注入 ───────────────────────────

export {evaluateScriptFn, injectPreloadScriptFn} from './script.js';

// ─── Script Injector 配置管理 ───────────────────────────

export {createInjectScript, getInjectConfigStore, getNextId, setNextId} from './createInjectScript.js';
export {listInjectScripts} from './listInjectScripts.js';
export {updateInjectScript} from './updateInjectScript.js';
export {deleteInjectScript} from './deleteInjectScript.js';
export {checkUrlMatches} from './checkUrlMatches.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  ScriptResult,
  EvaluateScriptParams,
  EvaluateScriptResult,
  InjectPreloadScriptParams,
  InjectPreloadScriptResult,
} from './script.js';

export type {
  InjectConfigEntry,
  CreateInjectScriptData,
  ListInjectScriptEntry,
  ListInjectScriptsData,
  UpdateInjectScriptData,
  DeleteInjectScriptData,
  MatchedScriptEntry,
  CheckUrlMatchesData,
  ScriptInjectorResult,
  CreateInjectScriptResult,
  ListInjectScriptsResult,
  UpdateInjectScriptResult,
  DeleteInjectScriptResult,
  CheckUrlMatchesResult,
} from './types.js';