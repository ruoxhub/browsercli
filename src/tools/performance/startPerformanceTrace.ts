/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {PerformanceRuntimeServices, StartPerformanceTraceResult} from './types.js';

/**
 * 在指定页面上启动性能追踪录制（纯函数版本）。
 *
 * 通过 CDP Tracing.start 启动 Chrome Tracing，可配置是否自动重新加载页面和自动停止。
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
      await page.goto('about:blank', {waitUntil: 'networkidle'});
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

    // Playwright: use CDP Tracing.start instead of page.tracing.start
    const client = await page.context().newCDPSession(page);
    await client.send('Tracing.start', {
      traceConfig: {
        includedCategories: categories.filter(c => !c.startsWith('-')),
        excludedCategories: categories.filter(c => c.startsWith('-')).map(c => c.slice(1)),
      },
    });

    if (params.reload) {
      await page.goto(pageUrlForTracing, {waitUntil: 'load'});
    }

    if (params.autoStop) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      // 动态导入避免循环依赖
      const {stopPerformanceTrace} = await import('./stopPerformanceTrace.js');
      const stopResult = await stopPerformanceTrace(runtime);
      // Map stop result to start result format
      return {
        success: stopResult.success,
        message: stopResult.message,
        tooltype: 'start_performance_trace',
        logFormat: stopResult.logFormat,
        data: stopResult.data as any,
      };
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
