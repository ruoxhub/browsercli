/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Hook 安装工具（defineTool 格式）───────────────────

export {hookXhrOpen} from './XhrOpen.js';
export {hookXhrSetRequestHeader} from './XhrSetRequestHeader.js';
export {hookFetch} from './Fetch.js';
export {hookCookie} from './Cookie.js';
export {hookWebSocket} from './WebSocket.js';
export {hookJsonParse} from './JsonParse.js';
export {hookJsonStringify} from './JsonStringify.js';
export {hookLocalStorage} from './LocalStorage.js';
export {hookSessionStorage} from './SessionStorage.js';
export {hookDateNow} from './DateNow.js';
export {hookPerformanceNow} from './PerformanceNow.js';
export {hookRandom} from './Random.js';
export {hookPromise} from './Promise.js';
export {hookHistory} from './History.js';
export {hookHistoryGo} from './HistoryGo.js';
export {hookLocationHref} from './LocationHref.js';
export {hookClose} from './Close.js';
export {hookConsoleLog} from './ConsoleLog.js';
export {hookConsoleClear} from './ConsoleClear.js';
export {hookConsoleProtect} from './ConsoleProtect.js';
export {hookConsoleTable} from './ConsoleTable.js';
export {fixedWindowSize} from './fixedWindowSize.js';
export {antiAntiHook} from './antiAntiHook.js';

// ─── Hook 管理工具（defineTool 格式）───────────────────

export {createHook} from './CreateHook.js';
export {injectHook} from './InjectHook.js';
export {syncHookRecords} from './SyncHookRecords.js';
export {getHookData} from './GetHookData.js';
export {removeHook} from './RemoveHook.js';
export {listCreatedHooks} from './ListCreatedHooks.js';
export {removeHookBrowser} from './RemoveHookBrowser.js';

// ─── 工具函数导出 ──────────────────────────────────────

export {
  buildRequestBindings,
  inferCandidateEnvNeeds,
  normalizeHookRecord,
  summarizeHookRecords,
  toHookRecordArray,
} from './record-utils.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  HookResult,
  HookManagementResult,
  InjectHookResult,
  SyncHookRecordsResult,
  GetHookDataResult,
  RemoveHookBrowserResult,
  LogFormat,
  StorageAction,
  ConsoleProtectMode,
  BypassTarget,
  Frame,
} from './types.js';
export type {
  HookRecordSummaryEntry,
  HookRecordSummaryResult,
  NormalizedHookRecord,
  RequestBinding,
} from './record-utils.js';
