/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AnalysisMode} from '../../modules/analyzer/ai/types.js';
import {runSessionAnalysis} from '../../modules/session/analyzeRequests.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const sessionGenerateReport = defineTool({
  name: 'session_generate_report',
  description:
    '基于提纯结果与指定分析模式触发 AI 报告生成，并将结果持久化到 ai_reports 表。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，默认当前活动会话。'),
    requestIds: zod
      .array(zod.string())
      .optional()
      .describe('仅分析这些请求 id；缺省分析会话全部请求。'),
    mode: zod
      .enum(['auto', 'api_reverse', 'security', 'perf', 'js_crypto'])
      .optional()
      .describe('分析模式，默认 auto。'),
  },
  handler: async (request, response) => {
    const {sessionId, mode, requestIds} = request.params as {
      sessionId?: string;
      mode?: AnalysisMode;
      requestIds?: string[];
    };

    const runtime = getRuntime();
    try {
      const result = await runSessionAnalysis({
        sessionId,
        mode,
        requestIds,
        persist: true,
        manager: runtime.captureSessionManager,
        llmService: runtime.llmService,
        getFileByUrl: url => runtime.collector.getFileByUrl(url),
      });

      response.setStructuredContent({
        reportId: result.reportId,
        reportMarkdown: result.reportMarkdown,
        mode: result.mode,
        llmUsed: result.llmUsed,
        requestCount: result.requestCount,
        tooltype: 'session_generate_report',
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('No session found')
      ) {
        throw createToolError(ErrorCodes.NOT_FOUND, error.message);
      }
      throw error;
    }
  },
});
