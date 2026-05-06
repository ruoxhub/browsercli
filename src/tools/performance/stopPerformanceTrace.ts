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

import type {
  StopPerformanceTraceResult,
  StopPerformanceTraceData,
} from './types.js';
import {getRuntime} from '../../runtime.js';

/**
 * 停止当前页面的性能追踪录制并分析结果（纯函数版本）。
 *
 * 通过 CDP Tracing.end 停止 Chrome Tracing，收集追踪数据并解析生成摘要。
 * 如果追踪数据解析成功，会自动存储结果供后续 Insight 分析。
 *
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function stopPerformanceTrace(): Promise<StopPerformanceTraceResult> {
  const contextProvider = getRuntime().contextProvider;
  if (!contextProvider) {
    return {
      success: false,
      message: '上下文提供器未初始化。',
      tooltype: 'stop_performance_trace',
      logFormat: 'text',
    };
  }

  if (!contextProvider.isRunningPerformanceTrace()) {
    return {
      success: false,
      message: '当前没有正在运行的性能追踪。',
      tooltype: 'stop_performance_trace',
      logFormat: 'text',
    };
  }

  const data: StopPerformanceTraceData = {};

  try {
    const page = await contextProvider.getActivePage();
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
      contextProvider.storeTraceRecording(result);
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
    contextProvider.setIsRunningPerformanceTrace(false);
  }
}
