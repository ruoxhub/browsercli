/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import type {GetWebSocketMessagesParams} from './types.js';

const DIRECTION_OPTIONS: readonly ['sent', 'received'] = ['sent', 'received'];

export const getWebSocketMessages = defineTool({
  name: 'get_websocket_messages',
  description: `Gets messages for a WebSocket connection. IMPORTANT: For binary/protobuf messages (like live streaming), use analyze_websocket_messages FIRST to understand message types, then use groupId parameter to filter specific types. Default mode shows summary only.`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod.number().describe('The wsid of the WebSocket connection.'),
    direction: zod
      .enum(DIRECTION_OPTIONS)
      .optional()
      .describe('Filter by direction: "sent" or "received".'),
    groupId: zod
      .string()
      .optional()
      .describe(
        'Filter by group ID (A, B, C, ...). Get group IDs from analyze_websocket_messages first.',
      ),
    pageSize: zod
      .number()
      .int()
      .positive()
      .default(10)
      .optional()
      .describe('Messages per page. Defaults to 10.'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Page number (0-based).'),
    show_content: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Set to true to show full message payload. Default false (summary only) to avoid large binary output.',
      ),
  },
  handler: async (request, response) => {
    const raw = request.params;
    const params: GetWebSocketMessagesParams = {
      wsid: raw.wsid,
      direction: raw.direction,
      groupId: raw.groupId,
      pageSize: raw.pageSize,
      pageIdx: raw.pageIdx,
      showContent: (raw as Record<string, unknown>).show_content as boolean | undefined,
    };
    const result = await getRuntime().networkModule.getWebSocketMessages(
      getRuntime().contextProvider!,
      params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'get_websocket_messages',
    });
  },
});
