/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import { zod } from '../../third_party/index.js';
import type {Page} from '../../third_party/index.js';
import {
  parseRawTraceBuffer,
  traceResultIsSuccess,
  getTraceSummary,
} from '../../trace-processing/parse.js';
import { ToolCategory } from '../categories.js';
import { defineTool } from '../ToolDefinition.js';
import type {Response, Context} from '../ToolDefinition.js';

/**
 * 停止追踪并输出结果到 response。
 * 使用 CDP Tracing.end 停止追踪，收集数据并解析生成摘要。
 */
async function stopTracingAndAppendOutput(
  page: Page,
  response: Response,
  context: Context,
): Promise<void> {
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
    // Ignore cleanup errors when the session is already gone
  }

  const traceEventsBuffer = Buffer.from(traceChunks.join(''));
  const result = await parseRawTraceBuffer(traceEventsBuffer);

  if (traceResultIsSuccess(result)) {
    context.storeTraceRecording(result);
    const traceSummaryText = await getTraceSummary(result);
    response.appendResponseLine(traceSummaryText);
  } else {
    response.appendResponseLine(`Error parsing trace: ${result.error}`);
  }

  context.setIsRunningPerformanceTrace(false);
}

/**
 * 在指定页面上启动性能追踪录制（纯函数版本）。
 *
 * 通过 CDP Tracing.start 启动 Chrome Tracing，可配置是否自动重新加载页面和自动停止。
 * 追踪数据用于分析页面性能问题和 Core Web Vitals。
 *
 * @param params - 追踪参数（reload / autoStop）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */

export const startPerformanceTrace = defineTool({
  name: 'start_performance_trace',
  description:
    'Starts a performance trace recording on the selected page. This can be used to look for performance problems and insights to improve the performance of the page. It will also report Core Web Vital (CWV) scores for the page.',
  annotations: {
    category: ToolCategory.PERFORMANCE,
    readOnlyHint: false,
  },
  schema: {
    reload: zod
      .boolean()
      .describe(
        'Determines if, once tracing has started, the page should be automatically reloaded.',
      ),
    autoStop: zod
      .boolean()
      .describe(
        'Determines if the trace recording should be automatically stopped after 5 seconds.',
      ),
  },
  handler: async (request, response, context) => {
    if (context.isRunningPerformanceTrace()) {
      response.appendResponseLine(
        'Error: a performance trace is already running. Use stop_performance_trace to stop it. Only one trace can be running at any given time.',
      );
      return;
    }
    context.setIsRunningPerformanceTrace(true);

    const runtime = getRuntime();
    const page = await runtime.collector.getActivePage();
    const pageUrlForTracing = page.url();

    if (request.params.reload) {
      // Before starting the recording, navigate to about:blank to clear out any state.
      await page.goto('about:blank', {
        waitUntil: 'networkidle',
      });
    }

    // Keep in sync with the categories arrays in:
    // https://source.chromium.org/chromium/chromium/src/+/main:third_party/devtools-frontend/src/front_end/panels/timeline/TimelineController.ts
    // https://github.com/GoogleChrome/lighthouse/blob/master/lighthouse-core/gather/gatherers/trace.js
    const categories = [
      '-*',
      'blink.console',
      'blink.user_timing',
      'devtools.timeline',
      'disabled-by-default-devtools.screenshot',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.invalidationTracking',
      'disabled-by-default-devtools.timeline.frame',
      'disabled-by-default-devtools.timeline.stack',
      'disabled-by-default-v8.cpu_profiler',
      'disabled-by-default-v8.cpu_profiler.hires',
      'latencyInfo',
      'loading',
      'disabled-by-default-lighthouse',
      'v8.execute',
      'v8',
    ];
    const client = await page.context().newCDPSession(page);
    await client.send('Tracing.start', {
      categories: categories.join(','),
    });

    // Detach the start session; stopTracingAndAppendOutput creates its own session
    try {
      await client.detach();
    } catch {
      // Ignore cleanup errors
    }

    if (request.params.reload) {
      await page.goto(pageUrlForTracing, {
        waitUntil: 'load',
      });
    }

    if (request.params.autoStop) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      await stopTracingAndAppendOutput(page, response, context);
    } else {
      response.appendResponseLine(
        `The performance trace is being recorded. Use stop_performance_trace to stop it.`,
      );
    }
  },
});
