/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getInsightOutput} from '../../trace-processing/parse.js';
import type {InsightName} from '../../trace-processing/parse.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 获取性能追踪录制中某个 Insight 的详细信息（纯函数版本）。
 *
 * 在追踪录制完成后，可使用此函数获取特定 Insight 的分析详情，
 * 如 "DocumentLatency"、"LCPBreakdown" 等。
 *
 * @param insightName - Insight 名称
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export const performanceAnalyzeInsight = defineTool({
  name: 'performance_analyze_insight',
  description:
    '针对追踪录制结果中高亮的某个性能 Insight 提供更详细的信息。',
  annotations: {
    category: ToolCategory.PERFORMANCE,
    readOnlyHint: true,
  },
  schema: {
    insightName: zod
      .string()
      .describe(
        '需要详细信息的 Insight 名称，例如："DocumentLatency" 或 "LCPBreakdown"。',
      ),
  },
  handler: async (request, response, context) => {
    const lastRecording = context.recordedTraces().at(-1);
    if (!lastRecording) {
      response.setStructuredContent({
        success: false,
        message:
          'No recorded traces found. Record a performance trace so you have Insights to analyze.',
        tooltype: 'performance_analyze_insight',
      });
      return;
    }

    const insightOutput = await getInsightOutput(
      lastRecording,
      'default',
      request.params.insightName as InsightName,
    );
    if ('error' in insightOutput) {
      response.setStructuredContent({
        success: false,
        message: insightOutput.error,
        tooltype: 'performance_analyze_insight',
      });
      return;
    }

    response.setStructuredContent({
      success: true,
      message: `已分析 insight: ${request.params.insightName}`,
      tooltype: 'performance_analyze_insight',
      data: {
        insightName: request.params.insightName,
        output: insightOutput.output,
      },
    });
  },
});
