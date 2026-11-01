/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Page 纯函数 ──────────────────────────────────────

export {waitForElement} from './waitForElement.js';
export {scrollBy} from './scrollBy.js';
export {checkBrowserHealth} from './checkBrowserHealth.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  PageRuntimeServices,
  WaitForElementParams,
  ScrollByParams,
  CheckBrowserHealthParams,
  ElementInfo,
  WaitForElementData,
  ScrollByData,
  HealthIssue,
  CheckBrowserHealthData,
  PageResult,
  WaitForElementResult,
  ScrollByResult,
  CheckBrowserHealthResult,
} from './types.js';
export {detectCaptcha} from './detectCaptcha.js';
