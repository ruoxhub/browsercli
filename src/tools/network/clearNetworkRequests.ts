/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {resolveActivePageIndex} from '../shared/activePageResolver.js';
import {defineTool} from '../ToolDefinition.js';

import type {ClearNetworkRequestsData} from './types.js';

export const clearNetworkRequests = defineTool({
  name: 'clear_network_requests',
  description:
    'Clear the cached network requests for the currently selected page (or a specified page). After clearing, the request list returned by list_network_requests will be empty and stable IDs will be reissued from 1.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    targetPageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Browser page index. When omitted, uses the currently active page.',
      ),
  },
  handler: async (request, response) => {
    try {
      const params = request.params;
      let targetPageIdx = params.targetPageIdx ?? 0;

      if (params.targetPageIdx === undefined) {
        const resolvedPage = resolveActivePageIndex(
          getRuntime().contextProvider!,
        );
        if ('message' in resolvedPage) {
          response.setStructuredContent({
            success: false,
            message: resolvedPage.message,
            tooltype: 'clear_network_requests',
            logFormat: 'json',
            data: {
              clearedCount: 0,
              targetPageIdx: 0,
            },
          });
          return;
        }
        targetPageIdx = resolvedPage.pageIdx;
      }

      // 快照当前已收集的请求数量，便于在结果中告知调用方实际清掉了多少条
      const before = getRuntime().contextProvider!.getNetworkRequests(
        false,
        targetPageIdx,
      );

      getRuntime().contextProvider!.clearNetworkRequests(targetPageIdx);

      const data: ClearNetworkRequestsData = {
        clearedCount: before.length,
        targetPageIdx,
      };

      response.setStructuredContent({
        success: true,
        message:
          before.length > 0
            ? `已清空页面 ${targetPageIdx} 的 ${before.length} 个网络请求`
            : `页面 ${targetPageIdx} 当前没有可清空的网络请求`,
        tooltype: 'clear_network_requests',
        data,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `清空请求失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'clear_network_requests',
        logFormat: 'json',
        data: {
          clearedCount: 0,
          targetPageIdx: request.params.targetPageIdx ?? 0,
        },
      });
    }
  },
});
