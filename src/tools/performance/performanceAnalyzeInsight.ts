/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getInsightOutput} from '../../trace-processing/parse.js';
import type {InsightName} from '../../trace-processing/parse.js';

import type {
  PerformanceRuntimeServices,
  PerformanceAnalyzeInsightResult,
  PerformanceAnalyzeInsightData,
} from './types.js';

/**
 * 获取性能追踪录制中某个 Insight 的详细信息（纯函数版本）。
 *
 * 在追踪录制完成后，可使用此函数获取特定 Insight 的分析详情，
 * 如 "DocumentLatency"、"LCPBreakdown" 等。
 *
 * @param runtime - Performance 运行时服务
 * @param insightName - Insight 名称
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function performanceAnalyzeInsight(
  runtime: PerformanceRuntimeServices,
  insightName: InsightName,
): Promise<PerformanceAnalyzeInsightResult> {
  const lastRecording = runtime.recordedTraces().at(-1);

  if (!lastRecording) {
    return {
      success: false,
      message: '未找到已录制的追踪数据。请先录制性能追踪以获取 Insights。',
      tooltype: 'performance_analyze_insight',
      logFormat: 'text',
    };
  }

  const data: PerformanceAnalyzeInsightData = {};

  try {
    const insightOutput = await getInsightOutput(
      lastRecording,
      'default',
      insightName,
    );

    if ('error' in insightOutput) {
      data.error =
        typeof insightOutput.error === 'string'
          ? insightOutput.error
          : JSON.stringify(insightOutput.error);
      return {
        success: false,
        message: `Insight "${insightName}" 分析失败。`,
        tooltype: 'performance_analyze_insight',
        logFormat: 'text',
        data,
      };
    }

    data.insightOutput = insightOutput.output;
    return {
      success: true,
      message: `Insight "${insightName}" 分析完成。`,
      tooltype: 'performance_analyze_insight',
      logFormat: 'text',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `分析 Insight 时出错：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'performance_analyze_insight',
      logFormat: 'text',
    };
  }
}
