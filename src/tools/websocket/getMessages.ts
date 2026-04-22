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
import type {WebSocketData} from '../network/WebSocketCollector.js';
import type {GetMessagesResult, GetWebSocketMessagesParams} from './types.js';

/**
 * 获取 WebSocket 连接的消息列表。
 *
 * 纯函数：从已有帧数据中筛选/分页/分组，不依赖 MCP Tool 框架。
 *
 * @param ws - WebSocket 连接数据
 * @param cachedSummary - 已缓存的流量摘要（可选）
 * @param cacheSummary - 缓存回调（可选）
 * @param params - 筛选/分页参数
 * @returns 结构化结果对象
 */
export function getWebSocketMessages(
  ws: WebSocketData,
  cachedSummary: ReturnType<typeof analyzeWebSocketFramesV2> | undefined,
  cacheSummary: (summary: ReturnType<typeof analyzeWebSocketFramesV2>) => void,
  params: GetWebSocketMessagesParams,
): GetMessagesResult {
  try {
    let frames = ws.frames;

    // 方向过滤
    if (params.direction) {
      frames = frames.filter(f => f.direction === params.direction);
    }

    const pageSize = params.pageSize ?? 10;
    const pageIdx = params.pageIdx ?? 0;

    // Mode A: 有 groupId - 显示分组消息
    if (params.groupId) {
      const groupId = params.groupId.toUpperCase();

      let summary = cachedSummary;
      if (!summary) {
        summary = analyzeWebSocketFramesV2(
          ws.frames,
          params.wsid,
          ws.connection.url,
        );
        cacheSummary(summary);
      }

      const indices = summary.groupToIndices.get(groupId);
      if (!indices || indices.length === 0) {
        return {
          success: true,
          message: `Group ${groupId} 未找到或为空`,
          tooltype: 'get_websocket_messages',
          lines: [
            `## Group ${groupId} Messages`,
            `<group not found or empty>`,
            ``,
            `Available groups: ${summary.groups.map(g => g.id).join(', ')}`,
          ],
        };
      }

      // 应用方向过滤到索引
      let filteredIndices = indices;
      if (params.direction) {
        filteredIndices = indices.filter(idx => {
          const frame = ws.frames[idx];
          return frame && frame.direction === params.direction;
        });
      }

      const lines = formatGroupMessages(ws.frames, filteredIndices, groupId, {
        pageSize,
        pageIdx,
      });

      return {
        success: true,
        message: `Group ${groupId} 消息列表`,
        tooltype: 'get_websocket_messages',
        lines,
      };
    }

    // Mode B: 无 groupId - 显示最近消息
    const lines = formatRecentMessages(frames, {pageSize, pageIdx});

    return {
      success: true,
      message: `Recent messages (wsid=${params.wsid})`,
      tooltype: 'get_websocket_messages',
      lines,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_websocket_messages',
      lines: [],
    };
  }
}
