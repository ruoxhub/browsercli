/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {formatWebSocketFrameDetail} from '../../formatters/websocketFormatter.js';
import {zod} from '../../third_party/index.js';

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

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
  handler: async (request, response, context) => {
    try {
      const ws = context.getWebSocketById(request.params.wsid);
      const frameIndex = request.params.frameIndex;

      if (frameIndex >= ws.frames.length) {
        throw new Error(
          `Frame index ${frameIndex} out of range. Total frames: ${ws.frames.length}`,
        );
      }

      const frame = ws.frames[frameIndex];
      const lines = formatWebSocketFrameDetail(frame, frameIndex);

      for (const line of lines) {
        response.appendResponseLine(line);
      }
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
