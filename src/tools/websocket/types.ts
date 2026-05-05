/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {TrafficSummary} from '../../formatters/websocketFormatter.js';
import type {WebSocketData, WebSocketFrame} from '../network/WebSocketCollector.js';

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

/** 重新导出 */
export type {WebSocketData, WebSocketFrame, TrafficSummary};
