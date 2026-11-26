/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {Page} from 'patchright';

export interface PageSelector {
  pageId?: string;
  pageIdx?: number;
  fallbackToSelected?: boolean;
}

export interface ResolvedPage {
  page: Page;
  pageId: string;
  pageIdx: number;
}

const LEGACY_PAGE_ID_RE = /^page-(\d+)$/;

/**
 * 归一化稳定页面 ID：
 * - 规范格式为纯正整数字符串（如 "1"、"2"），对齐 chrome-devtools `--pageId 2`；
 * - 向后兼容历史格式 "page-1" / "page-2"，自动剥离 "page-" 前缀。
 */
export function normalizePageId(raw: string): string {
  const trimmed = raw.trim();
  const legacy = LEGACY_PAGE_ID_RE.exec(trimmed);
  return legacy ? legacy[1]! : trimmed;
}
