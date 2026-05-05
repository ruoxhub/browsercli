/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── DOM 工具（defineTool 格式）───────────────────────

export {queryDom} from './queryDom.js';
export {getDomStructure} from './getDomStructure.js';
export {findClickableElements} from './findClickableElements.js';

// ─── 辅助类导出 ──────────────────────────────────────

export {WaitForHelper} from './WaitForHelper.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  DomResult,
  ElementInfo,
  ClickableElement,
  QueryDomParams,
  QueryDomResult,
  GetDomStructureParams,
  GetDomStructureResult,
  FindClickableElementsParams,
  FindClickableElementsResult,
  Frame,
} from './types.js';
