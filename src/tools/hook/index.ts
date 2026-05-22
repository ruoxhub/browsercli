/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
