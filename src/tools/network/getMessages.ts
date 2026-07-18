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
  description: `获取 WebSocket 连接的消息。重要：对于二进制/protobuf 消息（如直播流），请先使用 analyze_websocket_messages 理解消息类型，再用 groupId 参数筛选特定类型。默认模式仅显示摘要。`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    wsid: zod.number().describe('WebSocket 连接的 wsid。'),
    direction: zod
      .enum(DIRECTION_OPTIONS)
      .optional()
      .describe('按方向过滤："sent"（发送）或 "received"（接收）。'),
    groupId: zod
      .string()
      .optional()
      .describe(
        '按组 ID（A、B、C……）过滤。请先从 analyze_websocket_messages 获取组 ID。',
      ),
    pageSize: zod
      .number()
      .int()
      .positive()
      .default(10)
      .optional()
      .describe('每页消息数。默认 10。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('页码（从 0 开始）。'),
    show_content: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        '设为 true 显示完整消息负载。默认 false（仅摘要），以避免输出过大的二进制内容。',
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
      showContent: (raw as Record<string, unknown>).show_content as
        | boolean
        | undefined,
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
