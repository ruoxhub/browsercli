
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
