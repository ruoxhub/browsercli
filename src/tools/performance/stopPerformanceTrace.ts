/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {
  parseRawTraceBuffer,
  traceResultIsSuccess,
  getTraceSummary,
} from '../../trace-processing/parse.js';
import {logger} from '../../utils/logger.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 停止当前页面的性能追踪录制并分析结果。
 */
export const stopPerformanceTrace = defineTool({
  name: 'stop_performance_trace',
  description: 'Stop performance trace recording and analyze results via CDP Tracing.end',
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

    const data: Record<string, unknown> = {};

    try {
      const page = context.getSelectedPage();
      const client = await page.context().newCDPSession(page);

      const traceChunks: string[] = [];
      const eventHandler = (data: {method: string; params?: Record<string, unknown>}) => {
        if (data.method === 'Tracing.dataCollected' && data.params) {
          traceChunks.push((data.params as {value: string}).value);
        }
      };
      client.on('event', eventHandler);

      await client.send('Tracing.end');

      // Wait for tracingComplete with timeout
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 10_000);
        const completeHandler = (data: {method: string}) => {
          if (data.method === 'Tracing.tracingComplete') {
            clearTimeout(timeout);
            client.off('event', completeHandler);
            resolve();
          }
        };
        client.on('event', completeHandler);
      });

      client.off('event', eventHandler);

      try {
        await client.detach();
      } catch {
        // Ignore cleanup errors
      }

      const traceEventsBuffer = Buffer.from(traceChunks.join(''));
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
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `停止性能追踪时出错：${errorText}`,
            tooltype,
            data,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } finally {
      context.setIsRunningPerformanceTrace(false);
    }
  },
});
