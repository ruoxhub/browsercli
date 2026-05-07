/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  analyzeWebSocketFramesV2,
  formatGroupMessages,
  formatRecentMessages,
} from '../../formatters/websocketFormatter.js';
import {zod} from '../../third_party/index.js';

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

const trafficSummaryCache = new Map<number, ReturnType<typeof analyzeWebSocketFramesV2>>();

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
  handler: async (request, response, context) => {
    try {
      const ws = context.getWebSocketById(request.params.wsid);
      let frames = ws.frames;

      if (request.params.direction) {
        frames = frames.filter(f => f.direction === request.params.direction);
      }

      const pageSize = request.params.pageSize ?? 10;
      const pageIdx = request.params.pageIdx ?? 0;

      if (request.params.groupId) {
        const groupId = request.params.groupId.toUpperCase();

        let summary =
          context.getCachedTrafficSummary(request.params.wsid) ??
          trafficSummaryCache.get(request.params.wsid);

        if (!summary) {
          summary = analyzeWebSocketFramesV2(
            ws.frames,
            request.params.wsid,
            ws.connection.url,
          );
          trafficSummaryCache.set(request.params.wsid, summary);
        }

        const indices = summary.groupToIndices.get(groupId);
        if (!indices || indices.length === 0) {
          response.setStructuredContent({
            success: false,
            message: `Group ${groupId} not found or empty. Available groups: ${summary.groups.map(g => g.id).join(', ')}`,
            tooltype: 'get_websocket_messages',
            data: {
              wsid: request.params.wsid,
              groupId,
              availableGroups: summary.groups.map(g => g.id),
            },
          });
          return;
        }

        let filteredIndices = indices;
        if (request.params.direction) {
          filteredIndices = indices.filter(idx => {
            const frame = ws.frames[idx];
            return frame && frame.direction === request.params.direction;
          });
        }

        const lines = formatGroupMessages(ws.frames, filteredIndices, groupId, {
          pageSize,
          pageIdx,
        });

        const offset = pageIdx * pageSize;
        const paginatedIndices = filteredIndices.slice(offset, offset + pageSize);
        const frameData = request.params.show_content
          ? paginatedIndices.map(idx => {
              const frame = ws.frames[idx];
              return {
                index: idx,
                direction: frame.direction,
                timestamp: frame.timestamp,
                opcode: frame.opcode,
                payloadSize: frame.payloadData.length,
                payloadPreview: frame.payloadData.slice(0, 200),
              };
            })
          : paginatedIndices.map(idx => ({index: idx}));

        response.setStructuredContent({
          success: true,
          message: lines.join('\n'),
          tooltype: 'get_websocket_messages',
          data: {
            wsid: request.params.wsid,
            mode: 'group',
            groupId,
            frames: frameData,
            pagination: {
              pageIdx,
              pageSize,
              total: filteredIndices.length,
              totalPages: Math.ceil(filteredIndices.length / pageSize),
            },
          },
        });
        return;
      }

      const lines = formatRecentMessages(frames, {
        pageSize,
        pageIdx,
      });

      const offset = pageIdx * pageSize;
      const paginatedFrames = frames.slice(offset, offset + pageSize);
      const frameData = request.params.show_content
        ? paginatedFrames.map((frame, i) => ({
            index: offset + i,
            direction: frame.direction,
            timestamp: frame.timestamp,
            opcode: frame.opcode,
            payloadSize: frame.payloadData.length,
            payloadPreview: frame.payloadData.slice(0, 200),
          }))
        : paginatedFrames.map((_, i) => ({index: offset + i}));

      response.setStructuredContent({
        success: true,
        message: lines.join('\n'),
        tooltype: 'get_websocket_messages',
        data: {
          wsid: request.params.wsid,
          mode: 'recent',
          frames: frameData,
          pagination: {
            pageIdx,
            pageSize,
            total: frames.length,
            totalPages: Math.ceil(frames.length / pageSize),
          },
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_websocket_messages',
        data: null,
      });
    }
  },
});
