/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Navigation 纯函数 ──────────────────────────────────────

export {listPages} from './listPages.js';
export {selectPage} from './selectPage.js';
export {newPage} from './newPage.js';
export {navigatePage} from './navigatePage.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  NavigationRuntimeServices,
  ListPagesParams,
  SelectPageParams,
  NewPageParams,
  NavigatePageParams,
  PageInfo,
  ListPagesData,
  SelectPageData,
  NewPageData,
  NavigatePageData,
  NavigationResult,
  ListPagesResult,
  SelectPageResult,
  NewPageResult,
  NavigatePageResult,
} from './types.js';
