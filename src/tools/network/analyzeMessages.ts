/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  analyzeWebSocketFramesV2,
  formatTrafficSummary,
} from '../../formatters/websocketFormatter.js';
import {zod} from '../../third_party/index.js';

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const trafficSummaryCache = new Map<number, ReturnType<typeof analyzeWebSocketFramesV2>>();

const DIRECTION_OPTIONS: readonly ['sent', 'received'] = ['sent', 'received'];

export const analyzeWebSocketMessages = defineTool({
  name: 'analyze_websocket_messages',
  description: `Analyzes WebSocket messages and groups them by pattern/fingerprint. Essential for understanding binary/protobuf message types in live streaming scenarios. Returns statistics and sample indices for each message type.`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod
      .number()
      .describe('The wsid of the WebSocket connection to analyze.'),
    direction: zod
      .enum(DIRECTION_OPTIONS)
      .optional()
      .describe('Only analyze messages in this direction.'),
  },
  handler: async (request, response, context) => {
    try {
      const ws = context.getWebSocketById(request.params.wsid);
      let frames = ws.frames;

      if (request.params.direction) {
        frames = frames.filter(f => f.direction === request.params.direction);
      }

      const summary = analyzeWebSocketFramesV2(
        frames,
        request.params.wsid,
        ws.connection.url,
      );
      trafficSummaryCache.set(request.params.wsid, summary);

      const lines = formatTrafficSummary(summary);

      const groups = summary.groups.map(g => ({
        id: g.id,
        direction: g.direction,
        head4B: g.head4B,
        hint: g.hint,
        count: g.count,
        sizeRange: {
          min: g.minSize,
          max: g.maxSize,
          minFormatted: g.minSize < 1024 ? `${g.minSize}B` : `${(g.minSize / 1024).toFixed(1)}KB`,
          maxFormatted: g.maxSize < 1024 ? `${g.maxSize}B` : `${(g.maxSize / 1024).toFixed(1)}KB`,
        },
        sampleIndices: g.sampleIndices,
      }));

      response.setStructuredContent({
        success: true,
        message: lines.join('\n'),
        tooltype: 'analyze_websocket_messages',
        data: {
          wsid: request.params.wsid,
          url: summary.url,
          durationMs: summary.durationMs,
          totalFrames: summary.totalFrames,
          sentCount: summary.sentCount,
          receivedCount: summary.receivedCount,
          groups,
          pagination: {
            groupCount: summary.groups.length,
          },
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'analyze_websocket_messages',
        data: null,
      });
    }
  },
});
