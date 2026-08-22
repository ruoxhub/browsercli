/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {evaluateAndRespond} from './evaluateAndRespond.js';
import type {MonitorWindow} from './monitorTypes.js';

/**
 * 停止指定的事件监控。
 */
export const stopMonitor = defineTool({
  name: 'stop_monitor',
  description: '停止指定的事件监控。',
  annotations: {
    title: '停止监控',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    monitorId: zod.string().describe('要停止的监控 ID。'),
  },
  handler: async (request, response, context) => {
    const {monitorId} = request.params;

    await evaluateAndRespond<{error?: string}>({
      context: context as Context,
      response,
      tooltype: 'stop_monitor',
      evaluate: frame =>
        frame.evaluate((id: string) => {
          const browserWindow = window as unknown as MonitorWindow;

          if (
            !browserWindow.__mcp_monitors__ ||
            !browserWindow.__mcp_monitors__[id]
          ) {
            return {error: `Monitor not found: ${id}`};
          }

          const {target, listeners} = browserWindow.__mcp_monitors__[id];
          Object.entries(listeners).forEach(([eventType, handler]) => {
            target.removeEventListener(eventType, handler, true);
          });

          delete browserWindow.__mcp_monitors__[id];
          return {};
        }, monitorId),
      onSuccess: () => {
        response.setStructuredContent({
          success: true,
          message: `监控 "${monitorId}" 已停止`,
          tooltype: 'stop_monitor',
          data: {monitorId},
        });
      },
      onEvaluateFail: () => {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `监控未找到：${monitorId}`,
          {toolName: 'stop_monitor', monitorId},
        );
      },
    });
  },
});
