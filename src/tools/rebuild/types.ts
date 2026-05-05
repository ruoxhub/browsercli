/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CodeFile} from '../../types/index.js';

/** 单个缺失能力 */
export interface MissingCapability {
  capability: string;
  /** 匹配运行时错误的模式列表 */
  patterns: string[];
  reason: string;
  priority: number;
}

/** buildAutoBundle 的选项 */
export interface AutoBundleOptions {
  targetKeywords: string[];
  targetUrlPatterns: string[];
  targetFunctionNames: string[];
  targetActionDescription: string;
  maxEvidenceItems: number;
}

/** buildAutoBundle 的结果 */
export interface AutoBundleResult {
  entryCode: string;
  envCode: string;
  polyfillsCode: string;
  capture: Record<string, unknown>;
  notes: string[];
}
