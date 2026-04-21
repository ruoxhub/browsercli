/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {WebSocketData, WebSocketFrame} from '../../WebSocketCollector.js';
import type {TrafficSummary} from '../../formatters/websocketFormatter.js';

/** WebSocket 连接列表参数 */
export interface ListWebSocketConnectionsParams {
  pageSize?: number;
  pageIdx?: number;
  urlFilter?: string;
  includePreservedConnections?: boolean;
}

/** WebSocket 消息列表参数 */
export interface GetWebSocketMessagesParams {
  wsid: number;
  direction?: 'sent' | 'received';
  groupId?: string;
  pageSize?: number;
  pageIdx?: number;
  showContent?: boolean;
}

/** WebSocket 单帧参数 */
export interface GetWebSocketMessageParams {
  wsid: number;
  frameIndex: number;
}

/** WebSocket 分析参数 */
export interface AnalyzeWebSocketMessagesParams {
  wsid: number;
  direction?: 'sent' | 'received';
}

/** WebSocket 操作统一返回结构 */
export interface WebSocketResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat?: string;
}

/** 连接列表结果 */
export interface ListConnectionsResult extends WebSocketResult {
  tooltype: 'list_websocket_connections';
  connections: WebSocketData[];
}

/** 消息列表结果 */
export interface GetMessagesResult extends WebSocketResult {
  tooltype: 'get_websocket_messages';
  lines: string[];
}

/** 单帧结果 */
export interface GetMessageResult extends WebSocketResult {
  tooltype: 'get_websocket_message';
  lines: string[];
}

/** 分析结果 */
export interface AnalyzeMessagesResult extends WebSocketResult {
  tooltype: 'analyze_websocket_messages';
  summary: TrafficSummary;
  lines: string[];
}

/** 重新导出 */
export type {WebSocketData, WebSocketFrame, TrafficSummary};
