/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listWebSocketConnections = defineTool({
  name: 'list_websocket_connections',
  description: `列出所有 WebSocket 连接。获取 wsid 后，请先使用 analyze_websocket_messages(wsid) 理解消息模式，再查看单条消息。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '返回的最大连接数。省略时返回全部连接。',
      ),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        '返回的页码（从 0 开始）。省略时返回第一页。',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        '按 URL 过滤连接。仅返回包含该子串的连接。',
      ),
    includePreservedConnections: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        '设为 true 可返回最近 3 次导航期间保留的连接。',
      ),
  },
  handler: async (request, response) => {
    const result = getRuntime().networkModule.listWebSockets(
      getRuntime().contextProvider!,
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'list_websocket_connections',
    });
  },
});
