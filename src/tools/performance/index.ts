/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Performance 纯函数 ─────────────────────────────────

export {startPerformanceTrace} from './startPerformanceTrace.js';
export {stopPerformanceTrace} from './stopPerformanceTrace.js';
export {performanceAnalyzeInsight} from './performanceAnalyzeInsight.js';
export {getPerformanceMetrics} from './getPerformanceMetrics.js';

// ─── 类型导出 ───────────────────────────────────────────

export type {
  PerformanceRuntimeServices,
  StartPerformanceTraceParams,
  StopPerformanceTraceParams,
  PerformanceAnalyzeInsightParams,
  GetPerformanceMetricsParams,
  StartPerformanceTraceData,
  StopPerformanceTraceData,
  PerformanceAnalyzeInsightData,
  GetPerformanceMetricsData,
  PerformanceResult,
  StartPerformanceTraceResult,
  StopPerformanceTraceResult,
  PerformanceAnalyzeInsightResult,
  GetPerformanceMetricsResult,
} from './types.js';
