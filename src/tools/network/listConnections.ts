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
