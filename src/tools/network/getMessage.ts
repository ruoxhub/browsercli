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
  description: `按帧索引获取单条 WebSocket 消息。请先使用 get_websocket_messages 或 analyze_websocket_messages 找到帧索引。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod.number().describe('WebSocket 连接的 wsid。'),
    frameIndex: zod
      .number()
      .int()
      .min(0)
      .describe('要获取的帧索引（从 0 开始）。'),
    decode: zod
      .enum(['auto', 'protobuf', 'json', 'raw'])
      .optional()
      .describe(
        '解码模式：auto 自动识别，protobuf 按 protobuf 解析，json 提取 JSON，raw 原样。',
      ),
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
