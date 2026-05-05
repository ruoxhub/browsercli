/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listWebSocketConnections = defineTool({
  name: 'list_websocket_connections',
  description: `List all WebSocket connections. After getting wsid, use analyze_websocket_messages(wsid) FIRST to understand message patterns before viewing individual messages.`,
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
        'Maximum number of connections to return. When omitted, returns all connections.',
      ),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Page number to return (0-based). When omitted, returns the first page.',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        'Filter connections by URL. Only connections containing this substring will be returned.',
      ),
    includePreservedConnections: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Set to true to return the preserved connections over the last 3 navigations.',
      ),
  },
  handler: async (request, response, context) => {
    try {
      let connections = context.getWebSocketConnections(
        request.params.includePreservedConnections,
      );

      // URL 过滤
      if (request.params.urlFilter) {
        const filter = request.params.urlFilter.toLowerCase();
        connections = connections.filter(ws =>
          ws.connection.url.toLowerCase().includes(filter),
        );
      }

      // 分页
      const pageSize = request.params.pageSize ?? connections.length;
      const pageIdx = request.params.pageIdx ?? 0;
      const offset = pageIdx * pageSize;
      const paged = connections.slice(offset, offset + pageSize);

      const result = {
        success: true,
        message: `找到 ${connections.length} 个 WebSocket 连接`,
        tooltype: 'list_websocket_connections',
        data: {
          connections: paged.map(ws => ({
            wsid: ws.stableId,
            url: ws.connection.url,
            state: ws.connection.state,
            frameCount: ws.frames.length,
          })),
          total: connections.length,
          pageIdx,
          pageSize,
        },
      };

      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const errorResult = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_websocket_connections',
        data: {connections: [], total: 0, pageIdx: 0, pageSize: 0},
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(errorResult, null, 2));
      response.appendResponseLine('```');
    }
  },
});
