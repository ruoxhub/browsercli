/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';
import type {
  GetPerformanceMetricsResult,
  GetPerformanceMetricsData,
} from './types.js';

/**
 * 获取当前页面的性能指标（纯函数版本）。
 *
 * 通过浏览器 Performance API 采集导航时间、资源统计、
 * Paint 事件 (FCP/LCP) 和 CLS 等指标。
 *
 * @param page - Puppeteer Page 对象
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function getPerformanceMetrics(
  page: Page,
): Promise<GetPerformanceMetricsResult> {
  try {
    const metrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType(
        'navigation',
      )[0] as PerformanceNavigationTiming;

      const result: Record<string, unknown> = {
        domContentLoaded:
          perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
        loadComplete: perf.loadEventEnd - perf.loadEventStart,

        dns: perf.domainLookupEnd - perf.domainLookupStart,
        tcp: perf.connectEnd - perf.connectStart,
        request: perf.responseStart - perf.requestStart,
        response: perf.responseEnd - perf.responseStart,

        total: perf.loadEventEnd - perf.fetchStart,

        resources: performance.getEntriesByType('resource').length,
      };

      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      if (fcp) {
        result.firstContentfulPaint = fcp.startTime;
      }

      const lcpEntries = performance.getEntriesByType(
        'largest-contentful-paint',
      );
      if (lcpEntries.length > 0) {
        result.largestContentfulPaint =
          lcpEntries[lcpEntries.length - 1].startTime;
      }

      const clsEntries = performance.getEntriesByType('layout-shift') as Array<
        PerformanceEntry & {value: number; hadRecentInput: boolean}
      >;
      if (clsEntries.length > 0) {
        let clsValue = 0;
        for (const entry of clsEntries) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
        result.cumulativeLayoutShift = clsValue;
      }

      return result;
    });

    const data: GetPerformanceMetricsData = {metrics};

    return {
      success: true,
      message: `获取性能指标成功，共 ${Object.keys(metrics).length} 项`,
      tooltype: 'get_performance_metrics',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `获取性能指标失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_performance_metrics',
      logFormat: 'json',
    };
  }
}
