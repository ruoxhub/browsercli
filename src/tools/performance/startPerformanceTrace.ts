/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {PerformanceRuntimeServices, StartPerformanceTraceResult} from './types.js';

/**
 * 在指定页面上启动性能追踪录制（纯函数版本）。
 *
 * 启动 Chrome Tracing，可配置是否自动重新加载页面和自动停止。
 * 追踪数据用于分析页面性能问题和 Core Web Vitals。
 *
 * @param runtime - Performance 运行时服务
 * @param params - 追踪参数（reload / autoStop）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function startPerformanceTrace(
  runtime: PerformanceRuntimeServices,
  params: {reload: boolean; autoStop: boolean},
): Promise<StartPerformanceTraceResult> {
  if (runtime.isRunningPerformanceTrace()) {
    return {
      success: false,
      message:
        '性能追踪已在运行中。请先使用 stop_performance_trace 停止当前追踪。',
      tooltype: 'start_performance_trace',
      logFormat: 'text',
    };
  }

  runtime.setIsRunningPerformanceTrace(true);

  try {
    const page = await runtime.getActivePage();
    const pageUrlForTracing = page.url();

    if (params.reload) {
      await page.goto('about:blank', {waitUntil: ['networkidle0']});
    }

    // 与 DevTools / Lighthouse 保持同步的 trace categories
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
    await page.tracing.start({categories});

    if (params.reload) {
      await page.goto(pageUrlForTracing, {waitUntil: ['load']});
    }

    if (params.autoStop) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      // 动态导入避免循环依赖
      const {stopPerformanceTrace} = await import('./stopPerformanceTrace.js');
      return stopPerformanceTrace(runtime);
    }

    return {
      success: true,
      message: '性能追踪已开始录制。使用 stop_performance_trace 停止追踪。',
      tooltype: 'start_performance_trace',
      logFormat: 'text',
      data: {autoStop: params.autoStop},
    };
  } catch (error) {
    runtime.setIsRunningPerformanceTrace(false);
    return {
      success: false,
      message: `启动性能追踪失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'start_performance_trace',
      logFormat: 'text',
    };
  }
}
