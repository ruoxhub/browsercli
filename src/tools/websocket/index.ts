/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── WebSocket 分析函数 ─────────────────────────────────

export {listWebSocketConnections} from './listConnections.js';
export {getWebSocketMessages} from './getMessages.js';
export {getWebSocketMessage} from './getMessage.js';
export {analyzeWebSocketMessages} from './analyzeMessages.js';

// ─── 类型导出 ───────────────────────────────────────────

export type {
  ListWebSocketConnectionsParams,
  GetWebSocketMessagesParams,
  GetWebSocketMessageParams,
  AnalyzeWebSocketMessagesParams,
  WebSocketResult,
  ListConnectionsResult,
  GetMessagesResult,
  GetMessageResult,
  AnalyzeMessagesResult,
} from './types.js';

// ─── Runtime 适配包装 ──────────────────────────────────
// 纯函数需要数据参数，ToolAdapter 通过 callMode:'runtime' 传入 ToolContextProvider。
// 以下包装函数从 runtime 获取 WebSocket 数据后调用纯函数。

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';
import {listWebSocketConnections as _listConnections} from './listConnections.js';
import {getWebSocketMessages as _getMessages} from './getMessages.js';
import {getWebSocketMessage as _getMessage} from './getMessage.js';
import {analyzeWebSocketMessages as _analyzeMessages} from './analyzeMessages.js';
import type {
  ListWebSocketConnectionsParams,
  GetWebSocketMessagesParams,
  GetWebSocketMessageParams,
  AnalyzeWebSocketMessagesParams,
} from './types.js';
import type {WebSocketData} from '../network/WebSocketCollector.js';

/**
 * 列出 WebSocket 连接 — runtime 适配版
 */
export async function listConnections(
  runtime: ToolContextProvider,
  params: ListWebSocketConnectionsParams = {},
) {
  const connections = runtime.getWebSocketConnections() as WebSocketData[];
  return _listConnections(connections, params);
}

/**
 * 获取 WebSocket 消息列表 — runtime 适配版
 */
export async function getMessages(
  runtime: ToolContextProvider,
  params: GetWebSocketMessagesParams = {} as GetWebSocketMessagesParams,
) {
  const ws = runtime.getWebSocketConnectionById(params.wsid) as WebSocketData | undefined;
  if (!ws) {
    return {
      success: false,
      message: `WebSocket 连接 ${params.wsid ?? 'unknown'} 未找到`,
      tooltype: 'get_websocket_messages' as const,
      lines: [],
    };
  }
  return _getMessages(ws, undefined, () => {}, params);
}

/**
 * 获取 WebSocket 单帧详情 — runtime 适配版
 */
export async function getMessage(
  runtime: ToolContextProvider,
  params: GetWebSocketMessageParams = {} as GetWebSocketMessageParams,
) {
  const ws = runtime.getWebSocketConnectionById(params.wsid) as WebSocketData | undefined;
  if (!ws) {
    return {
      success: false,
      message: `WebSocket 连接 ${params.wsid ?? 'unknown'} 未找到`,
      tooltype: 'get_websocket_message' as const,
      lines: [],
    };
  }
  return _getMessage(ws, params);
}

/**
 * 分析 WebSocket 消息 — runtime 适配版
 */
export async function analyzeMessages(
  runtime: ToolContextProvider,
  params: AnalyzeWebSocketMessagesParams = {} as AnalyzeWebSocketMessagesParams,
) {
  const ws = runtime.getWebSocketConnectionById(params.wsid) as WebSocketData | undefined;
  if (!ws) {
    return {
      success: false,
      message: `WebSocket 连接 ${params.wsid ?? 'unknown'} 未找到`,
      tooltype: 'analyze_websocket_messages' as const,
      summary: {
        wsid: params.wsid,
        url: 'unknown',
        durationMs: 0,
        totalFrames: 0,
        sentCount: 0,
        receivedCount: 0,
        groups: [],
        groupToIndices: new Map(),
      },
      lines: [],
    };
  }
  return _analyzeMessages(ws, params);
}
