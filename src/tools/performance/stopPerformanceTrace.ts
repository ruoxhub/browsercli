/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from '../../logger.js';
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
 * 停止 Chrome Tracing，解析追踪数据并生成摘要。
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
    const traceEventsBuffer = await page.tracing.stop();
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
    logger(`Error stopping performance trace: ${errorText}`);
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
