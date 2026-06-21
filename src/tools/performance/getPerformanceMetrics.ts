/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 获取当前页面的性能指标（纯函数版本）。
 *
 * 通过浏览器 Performance API 采集导航时间、资源统计、
 * Paint 事件 (FCP/LCP) 和 CLS 等指标。
 *
 * 使用 context.getSelectedFrame().evaluate() 代替 page.evaluate()，
 * 以获得 ToolAdapter 提供的超时保护，防止调试器暂停时无限等待。
 *
 * @returns 结构化结果 { success, message, tooltype, data }
 */
export const getPerformanceMetrics = defineTool({
  name: 'get_performance_metrics',
  description:
    'Gets page performance metrics from the Performance API, including navigation timing, resource timing, and paint events.',
  annotations: {
    category: ToolCategory.PERFORMANCE,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const frame = context.getSelectedFrame();

    const metrics = await frame.evaluate(() => {
      const performanceData: Record<string, unknown> = {};

      // Navigation Timing
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length > 0) {
        const nav = navEntries[0] as PerformanceNavigationTiming;
        performanceData.navigation = {
          domContentLoaded: nav.domContentLoadedEventEnd,
          loadComplete: nav.loadEventEnd,
          firstByte: nav.responseStart,
          dns: nav.domainLookupEnd - nav.domainLookupStart,
          tcp: nav.connectEnd - nav.connectStart,
          ttfb: nav.responseStart - nav.requestStart,
          download: nav.responseEnd - nav.responseStart,
        };
      }

      // Paint Timing
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      if (fcp) {
        performanceData.firstContentfulPaint = fcp.startTime;
      }

      // Largest Contentful Paint (if available)
      const lcpEntries = performance.getEntriesByType(
        'largest-contentful-paint',
      );
      if (lcpEntries.length > 0) {
        performanceData.largestContentfulPaint =
          lcpEntries[lcpEntries.length - 1].startTime;
      }

      // Cumulative Layout Shift (if available)
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
        performanceData.cumulativeLayoutShift = clsValue;
      }

      // Resource Timing Summary
      const resources = performance.getEntriesByType('resource');
      if (resources.length > 0) {
        performanceData.resources = {
          total: resources.length,
          byType: {} as Record<string, number>,
        };
        const byType: Record<string, number> = {};
        for (const resource of resources) {
          const type = (resource as PerformanceResourceTiming).initiatorType;
          byType[type] = (byType[type] || 0) + 1;
        }
        (performanceData.resources as {byType: Record<string, number>}).byType =
          byType;
      }

      return performanceData;
    });

    response.setStructuredContent({
      success: true,
      message: 'Performance metrics collected',
      tooltype: 'get_performance_metrics',
      data: metrics,
    });
  },
});
