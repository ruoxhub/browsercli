/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  analyzeWebSocketFramesV2,
  formatTrafficSummary,
} from '../../formatters/websocketFormatter.js';
import type {WebSocketData} from '../../WebSocketCollector.js';
import type {AnalyzeMessagesResult, AnalyzeWebSocketMessagesParams} from './types.js';

/**
 * 分析 WebSocket 消息模式并分组。
 *
 * 纯函数：分析帧数据，生成分组统计和采样索引，不依赖 MCP Tool 框架。
 *
 * @param ws - WebSocket 连接数据
 * @param params - 分析参数
 * @returns 结构化结果对象（包含 summary 和格式化 lines）
 */
export function analyzeWebSocketMessages(
  ws: WebSocketData,
  params: AnalyzeWebSocketMessagesParams,
): AnalyzeMessagesResult {
  try {
    let frames = ws.frames;

    // 方向过滤
    if (params.direction) {
      frames = frames.filter(f => f.direction === params.direction);
    }

    // 分析并生成摘要
    const summary = analyzeWebSocketFramesV2(
      frames,
      params.wsid,
      ws.connection.url,
    );

    // 格式化输出
    const lines = formatTrafficSummary(summary);

    // 添加使用提示
    lines.push(``);
    lines.push(`### Usage`);
    lines.push(
      `- View group: \`get_websocket_messages(wsid=${params.wsid}, groupId="A")\``,
    );
    lines.push(
      `- View single: \`get_websocket_message(wsid=${params.wsid}, frameIndex=0)\``,
    );

    return {
      success: true,
      message: `WebSocket 消息分析完成，共 ${summary.groups.length} 个分组`,
      tooltype: 'analyze_websocket_messages',
      summary,
      lines,
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'analyze_websocket_messages',
      summary: {
        wsid: params.wsid,
        url: ws.connection.url,
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
}
