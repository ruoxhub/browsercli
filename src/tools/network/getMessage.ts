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
        response.setStructuredContent({
          success: false,
          message: `Frame index ${frameIndex} out of range. Total frames: ${ws.frames.length}`,
          tooltype: 'get_websocket_message',
          data: {
            wsid: request.params.wsid,
            frameIndex,
            totalFrames: ws.frames.length,
          },
        });
        return;
      }

      const frame = ws.frames[frameIndex];
      const lines = formatWebSocketFrameDetail(frame, frameIndex);

      response.setStructuredContent({
        success: true,
        message: lines.join('\n'),
        tooltype: 'get_websocket_message',
        data: {
          wsid: request.params.wsid,
          frameIndex,
          frame: {
            direction: frame.direction,
            timestamp: frame.timestamp,
            timestampISO: new Date(frame.timestamp).toISOString(),
            opcode: frame.opcode,
            payloadSize: frame.payloadData.length,
            payloadPreview: frame.payloadData.slice(0, 500),
          },
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_websocket_message',
        data: null,
      });
    }
  },
});
