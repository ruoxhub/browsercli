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

/** 本地缓存 TrafficSummary，与 getMessages 共享 */
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

      // 方向过滤
      if (request.params.direction) {
        frames = frames.filter(f => f.direction === request.params.direction);
      }

      // 分析并缓存结果
      const summary = analyzeWebSocketFramesV2(
        frames,
        request.params.wsid,
        ws.connection.url,
      );
      trafficSummaryCache.set(request.params.wsid, summary);

      // 格式化输出摘要
      const lines = formatTrafficSummary(summary);
      for (const line of lines) {
        response.appendResponseLine(line);
      }

      // 添加使用提示
      response.appendResponseLine(``);
      response.appendResponseLine(`### Usage`);
      response.appendResponseLine(
        `- View group: \`get_websocket_messages(wsid=${request.params.wsid}, groupId="A")\``,
      );
      response.appendResponseLine(
        `- View single: \`get_websocket_message(wsid=${request.params.wsid}, frameIndex=0)\``,
      );
    } catch (error) {
      response.appendResponseLine(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
