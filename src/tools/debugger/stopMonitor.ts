/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 停止指定的事件监控。
 */
export const stopMonitor = defineTool({
  name: 'stop_monitor',
  description: 'Stops an event monitor.',
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

    try {
      const frame = (context as Context).getSelectedFrame();
      const result = await frame.evaluate((id: string) => {
        const browserWindow = window as typeof window & {
          __mcp_monitors__?: Record<
            string,
            {
              target: EventTarget;
              listeners: Record<string, EventListener>;
            }
          >;
        };

        if (!browserWindow.__mcp_monitors__ || !browserWindow.__mcp_monitors__[id]) {
          return {success: false, message: `Monitor not found: ${id}`};
        }

        const {target, listeners} = browserWindow.__mcp_monitors__[id];
        Object.entries(listeners).forEach(([eventType, handler]) => {
          target.removeEventListener(eventType, handler, true);
        });

        delete browserWindow.__mcp_monitors__[id];
        return {success: true};
      }, monitorId);

      if (result && typeof result === 'object') {
        const r = result as {success: boolean; message?: string};
        if (r.success) {
          response.setStructuredContent({
            success: true,
            message: `监控 "${monitorId}" 已停止`,
            tooltype: 'stop_monitor',
            data: { monitorId }
          });
        } else {
          response.setStructuredContent({
            success: false,
            message: r.message || `监控未找到：${monitorId}`,
            tooltype: 'stop_monitor',
            data: { monitorId }
          });
        }
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'stop_monitor',
        data: { monitorId: request.params.monitorId }
      });
    }
  },
});
