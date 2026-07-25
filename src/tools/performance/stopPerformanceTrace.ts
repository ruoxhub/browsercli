/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseRawTraceBuffer,
  traceResultIsSuccess,
  getTraceSummary,
} from '../../trace-processing/parse.js';
import {logger} from '../../utils/logger.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {
  endTrace,
  getTraceChunks,
  getTraceClient,
  waitForTracingComplete,
} from './traceState.js';

/**
 * 停止当前页面的性能追踪录制并分析结果。
 */
export const stopPerformanceTrace = defineTool({
  name: 'stop_performance_trace',
  description:
    '停止性能追踪录制并通过 CDP Tracing.end 分析其结果。',
  annotations: {category: ToolCategory.PERFORMANCE, readOnlyHint: true},
  schema: {},
  handler: async (_request, response, context) => {
    const tooltype = 'stop_performance_trace';

    if (!context.isRunningPerformanceTrace()) {
      response.setStructuredContent({
        success: false,
        message: '当前没有正在运行的性能追踪。',
        tooltype,
        logFormat: 'json',
      });
      return;
    }

    const client = getTraceClient();
    if (!client) {
      context.setIsRunningPerformanceTrace(false);
      response.setStructuredContent({
        success: false,
        message: '无法定位性能追踪的 CDP 会话，可能追踪已被异常中断。',
        tooltype,
        logFormat: 'json',
      });
      return;
    }

    const data: Record<string, unknown> = {};

    try {
      await client.send('Tracing.end');
      await waitForTracingComplete(client);

      try {
        await client.detach();
      } catch {
        // Ignore cleanup errors when the session is already gone
      }

      const traceEventsBuffer = Buffer.from(getTraceChunks().join(''));
      endTrace();
      const result = await parseRawTraceBuffer(traceEventsBuffer);

      if (traceResultIsSuccess(result)) {
        context.storeTraceRecording(result);
        const traceSummaryText = await getTraceSummary(result);
        data.traceSummary = traceSummaryText;

        response.setStructuredContent({
          success: true,
          message: '性能追踪已停止。',
          tooltype,
          logFormat: 'json',
          data,
        });
        return;
      }

      data.parseError = result.error;
      response.setStructuredContent({
        success: false,
        message: '追踪数据解析出错。',
        tooltype,
        logFormat: 'json',
        data,
      });
    } catch (e) {
      const errorText = e instanceof Error ? e.message : JSON.stringify(e);
      logger.debug(`Error stopping performance trace: ${errorText}`);
      response.setStructuredContent({
        success: false,
        message: `停止性能追踪时出错：${errorText}`,
        tooltype,
        data,
      });
    } finally {
      context.setIsRunningPerformanceTrace(false);
      endTrace();
    }
  },
});
