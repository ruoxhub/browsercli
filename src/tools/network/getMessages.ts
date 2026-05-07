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

/** 本地缓存 TrafficSummary，避免重复分析 */
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

      // 方向过滤
      if (request.params.direction) {
        frames = frames.filter(f => f.direction === request.params.direction);
      }

      const pageSize = request.params.pageSize ?? 10;
      const pageIdx = request.params.pageIdx ?? 0;

      // Mode A: 有 groupId - 显示分组消息
      if (request.params.groupId) {
        const groupId = request.params.groupId.toUpperCase();

        // 尝试从缓存获取摘要
        let summary =
          context.getCachedTrafficSummary(request.params.wsid) ??
          trafficSummaryCache.get(request.params.wsid);

        // 未缓存则分析并缓存
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
          response.appendResponseLine(`## Group ${groupId} Messages`);
          response.appendResponseLine(`<group not found or empty>`);
          response.appendResponseLine(``);
          response.appendResponseLine(
            `Available groups: ${summary.groups.map(g => g.id).join(', ')}`,
          );
          return;
        }

        // 应用方向过滤到索引
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
        for (const line of lines) {
          response.appendResponseLine(line);
        }
        return;
      }

      // Mode B: 无 groupId - 显示最近消息
      response.appendResponseLine(
        `## Recent Messages (wsid=${request.params.wsid})`,
      );

      const lines = formatRecentMessages(frames, {
        pageSize,
        pageIdx,
      });
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
