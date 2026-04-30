/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {WebSocketData} from '../network/WebSocketCollector.js';

import type {ListConnectionsResult, ListWebSocketConnectionsParams} from './types.js';

/**
 * 列出 WebSocket 连接。
 *
 * 纯函数：从已有连接数据中筛选/分页，不依赖 MCP Tool 框架。
 *
 * @param connections - 全部 WebSocket 连接数据
 * @param params - 筛选/分页参数
 * @returns 结构化结果对象
 */
export function listWebSocketConnections(
  connections: WebSocketData[],
  params: ListWebSocketConnectionsParams = {},
): ListConnectionsResult {
  try {
    let filtered = connections;

    // URL 过滤
    if (params.urlFilter) {
      const filter = params.urlFilter.toLowerCase();
      filtered = filtered.filter(
        ws => ws.connection.url.toLowerCase().includes(filter),
      );
    }

    // 分页
    const pageSize = params.pageSize ?? filtered.length;
    const pageIdx = params.pageIdx ?? 0;
    const offset = pageIdx * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);

    return {
      success: true,
      message: `找到 ${filtered.length} 个 WebSocket 连接`,
      tooltype: 'list_websocket_connections',
      connections: paged,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'list_websocket_connections',
      connections: [],
    };
  }
}
