/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Script Injector 纯函数 ─────────────────────────────

export {createInjectScript, getInjectConfigStore, getNextId, setNextId} from './createInjectScript.js';
export {listInjectScripts} from './listInjectScripts.js';
export {updateInjectScript} from './updateInjectScript.js';
export {deleteInjectScript} from './deleteInjectScript.js';
export {checkUrlMatches} from './checkUrlMatches.js';

// ─── 类型导出 ─────────────────────────────────────────

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
