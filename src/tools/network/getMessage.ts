/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import type {GetWebSocketMessageParams} from './types.js';

export const getWebSocketMessage = defineTool({
  name: 'get_websocket_message',
  description: `Gets a single WebSocket message by its frame index. Use get_websocket_messages or analyze_websocket_messages first to find the frame index.`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod.number().describe('The wsid of the WebSocket connection.'),
    frameIndex: zod
      .number()
      .int()
      .min(0)
      .describe('The frame index (0-based) to retrieve.'),
  },
  handler: async (request, response) => {
    const result = getRuntime().networkModule.getWebSocketMessage(
      getRuntime().contextProvider!,
      request.params as GetWebSocketMessageParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'get_websocket_message',
    });
  },
});
