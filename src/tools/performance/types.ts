/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';
import type {InsightName, TraceResult} from '../../trace-processing/parse.js';

// ─── 运行时服务接口 ──────────────────────────────────────

/**
 * Performance 运行时服务（从 McpContext 提取的接口）。
 *
 * 纯函数通过此接口访问追踪状态和页面数据，
 * 调用方负责提供具体实现。
 */
export interface PerformanceRuntimeServices {
  /** 是否正在运行性能追踪 */
  isRunningPerformanceTrace: () => boolean;
  /** 设置性能追踪运行状态 */
  setIsRunningPerformanceTrace: (running: boolean) => void;
  /** 存储追踪录制结果 */
  storeTraceRecording: (result: TraceResult) => void;
  /** 获取已录制的追踪记录列表 */
  recordedTraces: () => TraceResult[];
  /** 获取当前活跃页面 */
  getActivePage: () => Promise<Page>;
}

// ─── 参数类型 ────────────────────────────────────────────

/** startPerformanceTrace 参数 */
export interface StartPerformanceTraceParams {
  /** 是否在开始追踪后自动重新加载页面 */
  reload: boolean;
  /** 是否在 5 秒后自动停止追踪 */
  autoStop: boolean;
}

/** stopPerformanceTrace 参数（无参数） */
export interface StopPerformanceTraceParams {}

/** performanceAnalyzeInsight 参数 */
export interface PerformanceAnalyzeInsightParams {
  /** 要分析的 Insight 名称，如 "DocumentLatency" 或 "LCPBreakdown" */
  insightName: InsightName;
}

/** getPerformanceMetrics 参数（无参数） */
export interface GetPerformanceMetricsParams {}

// ─── 数据类型 ────────────────────────────────────────────

/** startPerformanceTrace 返回数据 */
export interface StartPerformanceTraceData {
  /** 追踪是否自动停止 */
  autoStop: boolean;
}

/** stopPerformanceTrace 返回数据 */
export interface StopPerformanceTraceData {
  /** 追踪摘要文本 */
  traceSummary?: string;
  /** 解析错误信息 */
  parseError?: string;
}

/** performanceAnalyzeInsight 返回数据 */
export interface PerformanceAnalyzeInsightData {
  /** Insight 分析输出 */
  insightOutput?: string;
  /** 错误信息 */
  error?: string;
}

/** getPerformanceMetrics 返回数据 */
export interface GetPerformanceMetricsData {
  /** 性能指标对象 */
  metrics: Record<string, unknown>;
}

import type {MessagesResult} from '../shared/types.js';

// ─── 结果类型 ────────────────────────────────────────────

/**
 * Performance 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface PerformanceResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat: string;
}

/** startPerformanceTrace 结果 */
export interface StartPerformanceTraceResult
  extends PerformanceResult<StartPerformanceTraceData> {
  tooltype: 'start_performance_trace';
}

/** stopPerformanceTrace 结果 */
export interface StopPerformanceTraceResult
  extends PerformanceResult<StopPerformanceTraceData> {
  tooltype: 'stop_performance_trace';
}

/** performanceAnalyzeInsight 结果 */
export interface PerformanceAnalyzeInsightResult
  extends PerformanceResult<PerformanceAnalyzeInsightData> {
  tooltype: 'performance_analyze_insight';
}

/** getPerformanceMetrics 结果 */
export interface GetPerformanceMetricsResult
  extends PerformanceResult<GetPerformanceMetricsData> {
  tooltype: 'get_performance_metrics';
}
