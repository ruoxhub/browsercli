/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from '../../utils/logger.js';
import {
  parseRawTraceBuffer,
  traceResultIsSuccess,
  getTraceSummary,
} from '../../trace-processing/parse.js';
import type {
  PerformanceRuntimeServices,
  StopPerformanceTraceResult,
  StopPerformanceTraceData,
} from './types.js';

/**
 * 停止当前页面的性能追踪录制并分析结果（纯函数版本）。
 *
 * 通过 CDP Tracing.end 停止 Chrome Tracing，收集追踪数据并解析生成摘要。
 * 如果追踪数据解析成功，会自动存储结果供后续 Insight 分析。
 *
 * @param runtime - Performance 运行时服务
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function stopPerformanceTrace(
  runtime: PerformanceRuntimeServices,
): Promise<StopPerformanceTraceResult> {
  if (!runtime.isRunningPerformanceTrace()) {
    return {
      success: false,
      message: '当前没有正在运行的性能追踪。',
      tooltype: 'stop_performance_trace',
      logFormat: 'text',
    };
  }

  const data: StopPerformanceTraceData = {};

  try {
    const page = await runtime.getActivePage();

    // Playwright: use CDP to stop tracing and collect data
    const client = await page.context().newCDPSession(page);

    // Collect trace data via CDP events
    const traceChunks: string[] = [];
    const dataHandler = (event: {value: string}) => {
      traceChunks.push(event.value);
    };
    client.on('Tracing.tracingComplete', () => {});
    client.on('Tracing.dataCollected', dataHandler as any);

    await client.send('Tracing.end');

    // Wait for tracingComplete event
    await new Promise<void>(resolve => {
      client.on('Tracing.tracingComplete', () => resolve());
      // Timeout fallback
      setTimeout(resolve, 5000);
    });

    client.off('Tracing.dataCollected', dataHandler as any);

    const traceEventsBuffer = Buffer.from(traceChunks.join(''));

    const result = await parseRawTraceBuffer(traceEventsBuffer);

    if (traceResultIsSuccess(result)) {
      runtime.storeTraceRecording(result);
      const traceSummaryText = await getTraceSummary(result);
      data.traceSummary = traceSummaryText;

      return {
        success: true,
        message: '性能追踪已停止。',
        tooltype: 'stop_performance_trace',
        logFormat: 'text',
        data,
      };
    }

    data.parseError = result.error;
    return {
      success: false,
      message: '追踪数据解析出错。',
      tooltype: 'stop_performance_trace',
      logFormat: 'text',
      data,
    };
  } catch (e) {
    const errorText = e instanceof Error ? e.message : JSON.stringify(e);
    logger.debug(`Error stopping performance trace: ${errorText}`);
    return {
      success: false,
      message: `停止性能追踪时出错：${errorText}`,
      tooltype: 'stop_performance_trace',
      logFormat: 'text',
      data,
    };
  } finally {
    runtime.setIsRunningPerformanceTrace(false);
  }
}
