/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {AnalyzeWebSocketMessagesParams} from './types.js';

const DIRECTION_OPTIONS: readonly ['sent', 'received'] = ['sent', 'received'];

export const analyzeWebSocketMessages = defineTool({
  name: 'analyze_websocket_messages',
  description: `分析 WebSocket 消息并按模式/指纹分组。对于理解直播等场景中的二进制/protobuf 消息类型至关重要。返回每种消息类型的统计信息与样本索引。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod
      .number()
      .describe('要分析的 WebSocket 连接的 wsid。'),
    direction: zod
      .enum(DIRECTION_OPTIONS)
      .optional()
      .describe('仅分析该方向的消息。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.analyzeWebSocketMessages(
      getRuntime().contextProvider!,
      request.params as AnalyzeWebSocketMessagesParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'analyze_websocket_messages',
    });
  },
});
