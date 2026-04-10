/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from '../logger.js';
import {zod} from '../third_party/index.js';
import type {Page} from '../third_party/index.js';
import type {InsightName, TraceResult} from '../trace-processing/parse.js';
import {
  getInsightOutput,
  getTraceSummary,
  parseRawTraceBuffer,
  traceResultIsSuccess,
} from '../trace-processing/parse.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

/**
 * Starts a performance trace recording on the selected page.
 * This can be used to look for performance problems and insights to improve the performance of the page.
 * It will also report Core Web Vital (CWV) scores for the page.
 */
export const startPerformanceTrace = defineTool({
  name: 'start_performance_trace',
  description:
    'Starts a performance trace recording on the selected page. This can be used to look for performance problems and insights to improve the performance of the page. It will also report Core Web Vital (CWV) scores for the page.',
  annotations: {
    category: ToolCategory.PERFORMANCE,
    readOnlyHint: true,
    title: 'Start performance trace',
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
  handler: async (request, response, context, runtime) => {
    if (context.isRunningPerformanceTrace()) {
      response.appendResponseLine(
        'Error: a performance trace is already running. Use stop_performance_trace to stop it. Only one trace can be running at any given time.',
      );
      return;
    }
    context.setIsRunningPerformanceTrace(true);

    const page = await runtime.collector.getActivePage();
    const pageUrlForTracing = page.url();

    if (request.params.reload) {
      // Before starting the recording, navigate to about:blank to clear out any state.
      await page.goto('about:blank', {
        waitUntil: ['networkidle0'],
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
    await page.tracing.start({
      categories,
    });

    if (request.params.reload) {
      await page.goto(pageUrlForTracing, {
        waitUntil: ['load'],
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

/**
 * Stops the active performance trace recording on the selected page.
 */
export const stopPerformanceTrace = defineTool({
  name: 'stop_performance_trace',
  description:
    'Stops the active performance trace recording on the selected page and analyzes the results.',
  annotations: {
    category: ToolCategory.PERFORMANCE,
    readOnlyHint: true,
    title: 'Stop performance trace',
  },
  schema: {},
  handler: async (_request, response, context, runtime) => {
    if (!context.isRunningPerformanceTrace()) {
      response.appendResponseLine('No performance trace is currently running.');
      return;
    }
    const page = await runtime.collector.getActivePage();
    await stopTracingAndAppendOutput(page, response, context);
  },
});

/**
 * Provides more detailed information on a specific Performance Insight that was highlighted in the results of a trace recording.
 */
export const performanceAnalyzeInsight = defineTool({
  name: 'performance_analyze_insight',
  description:
    'Provides more detailed information on a specific Performance Insight that was highlighted in the results of a trace recording.',
  annotations: {
    category: ToolCategory.PERFORMANCE,
    readOnlyHint: true,
    title: 'Analyze performance insight',
  },
  schema: {
    insightName: zod
      .string()
      .describe(
        'The name of the Insight you want more information on. For example: "DocumentLatency" or "LCPBreakdown"',
      ),
  },
  handler: async (request, response, context, runtime) => {
    const lastRecording = context.recordedTraces().at(-1);
    if (!lastRecording) {
      response.appendResponseLine(
        'No recorded traces found. Record a performance trace so you have Insights to analyze.',
      );
      return;
    }

    const insightOutput = await getInsightOutput(
      lastRecording,
      'default',
      request.params.insightName as InsightName,
    );
    if ('error' in insightOutput) {
      response.appendResponseLine(
        typeof insightOutput.error === 'string'
          ? insightOutput.error
          : JSON.stringify(insightOutput.error),
      );
      return;
    }

    response.appendResponseLine(insightOutput.output);
  },
});

/**
 * Gets performance metrics from the Performance API for the current page.
 */
export const getPerformanceMetrics = defineTool({
  name: 'get_performance_metrics',
  description:
    'Gets page performance metrics from the Performance API, including navigation timing, resource timing, and paint events.',
  annotations: {
    category: ToolCategory.PERFORMANCE,
    readOnlyHint: true,
    title: 'Get performance metrics',
  },
  schema: {},
  handler: async (_request, response, context, runtime) => {
    const metrics = await runtime.pageController.getPerformanceMetrics();

    response.appendResponseLine('## Performance Metrics');
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(metrics, null, 2));
    response.appendResponseLine('```');
  },
});

async function stopTracingAndAppendOutput(
  page: Page,
  response: {appendResponseLine: (value: string) => void},
  context: {
    setIsRunningPerformanceTrace: (x: boolean) => void;
    storeTraceRecording: (result: TraceResult) => void;
  },
): Promise<void> {
  try {
    const traceEventsBuffer = await page.tracing.stop();
    const result = await parseRawTraceBuffer(traceEventsBuffer);
    response.appendResponseLine('The performance trace has been stopped.');
    if (traceResultIsSuccess(result)) {
      context.storeTraceRecording(result);
      const traceSummaryText = await getTraceSummary(result);
      response.appendResponseLine(traceSummaryText);
    } else {
      response.appendResponseLine(
        'There was an unexpected error parsing the trace:',
      );
      response.appendResponseLine(result.error);
    }
  } catch (e) {
    const errorText = e instanceof Error ? e.message : JSON.stringify(e);
    logger(`Error stopping performance trace: ${errorText}`);
    response.appendResponseLine(
      'An error occurred generating the response for this trace:',
    );
    response.appendResponseLine(errorText);
  } finally {
    context.setIsRunningPerformanceTrace(false);
  }
}
