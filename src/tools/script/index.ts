/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Script 执行与预加载注入 ───────────────────────────

export {
  evaluateScript,
  evaluateScriptFn,
  injectPreloadScript,
} from './script.js';

// ─── Script Injector 配置管理 ───────────────────────────

export {
  createInjectScript,
  getInjectConfigStore,
  getNextId,
  setNextId,
} from './createInjectScript.js';
export {listInjectScripts} from './listInjectScripts.js';
export {updateInjectScript} from './updateInjectScript.js';
export {deleteInjectScript} from './deleteInjectScript.js';
export {checkUrlMatches} from './checkUrlMatches.js';

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
