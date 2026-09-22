/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Page 纯函数 ──────────────────────────────────────

export {typeText} from './typeText.js';
export {waitForElement} from './waitForElement.js';
export {scrollBy} from './scrollBy.js';
export {checkBrowserHealth} from './checkBrowserHealth.js';
export {
  saveSessionState,
  restoreSessionState,
  listSessionStates,
  deleteSessionState,
  dumpSessionState,
  loadSessionState,
} from './sessionState.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  PageRuntimeServices,
  TypeTextParams,
  WaitForElementParams,
  ScrollByParams,
  SaveSessionStateParams,
  RestoreSessionStateParams,
  ListSessionStatesParams,
  DeleteSessionStateParams,
  DumpSessionStateParams,
  LoadSessionStateParams,
  CheckBrowserHealthParams,
  ElementInfo,
  TypeTextData,
  WaitForElementData,
  ScrollByData,
  SessionSnapshot,
  SaveSessionStateData,
  RestoreSessionStateData,
  ListSessionStatesData,
  DeleteSessionStateData,
  DumpSessionStateData,
  LoadSessionStateData,
  HealthIssue,
  CheckBrowserHealthData,
  PageResult,
  TypeTextResult,
  WaitForElementResult,
  ScrollByResult,
  SaveSessionStateResult,
  RestoreSessionStateResult,
  ListSessionStatesResult,
  DeleteSessionStateResult,
  DumpSessionStateResult,
  LoadSessionStateResult,
  CheckBrowserHealthResult,
} from './types.js';
export {detectCaptcha} from './detectCaptcha.js';
