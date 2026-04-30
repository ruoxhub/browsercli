/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {formatWebSocketFrameDetail} from '../../formatters/websocketFormatter.js';
import type {WebSocketData} from '../network/WebSocketCollector.js';

import type {GetMessageResult, GetWebSocketMessageParams} from './types.js';

/**
 * 获取 WebSocket 单帧详情。
 *
 * 纯函数：从已有帧数据中获取指定帧，不依赖 MCP Tool 框架。
 *
 * @param ws - WebSocket 连接数据
 * @param params - 帧索引参数
 * @returns 结构化结果对象
 */
export function getWebSocketMessage(
  ws: WebSocketData,
  params: GetWebSocketMessageParams,
): GetMessageResult {
  try {
    const frameIndex = params.frameIndex;

    if (frameIndex >= ws.frames.length) {
      return {
        success: false,
        message: `Frame index ${frameIndex} 超出范围。总帧数：${ws.frames.length}`,
        tooltype: 'get_websocket_message',
        lines: [],
      };
    }

    const frame = ws.frames[frameIndex];
    const lines = formatWebSocketFrameDetail(frame, frameIndex);

    return {
      success: true,
      message: `Frame ${frameIndex} 详情`,
      tooltype: 'get_websocket_message',
      lines,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_websocket_message',
      lines: [],
    };
  }
}
