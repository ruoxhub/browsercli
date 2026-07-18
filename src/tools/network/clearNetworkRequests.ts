/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const clearNetworkRequests = defineTool({
  name: 'clear_network_requests',
  description:
    '清空当前选中页面（或指定页面）的缓存网络请求。清空后，list_network_requests 返回的请求列表将为空，稳定的请求 ID 将从 1 重新编号。',
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
        '浏览器页面索引。省略时使用当前活动页面。',
      ),
  },
  handler: async (request, response) => {
    const result = getRuntime().networkModule.clearRequests(
      getRuntime().contextProvider!,
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'clear_network_requests',
    });
  },
});
