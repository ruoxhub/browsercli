/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {StopMonitorParams, StopMonitorResult} from './types.js';

/**
 * 停止指定的事件监控。
 *
 * @param frame - Puppeteer Frame 对象
 * @param monitorId - 要停止的监控 ID
 * @returns 结构化结果对象
 */
export async function stopMonitor(
  frame: Frame,
  params: StopMonitorParams = {},
): Promise<StopMonitorResult> {
  const monitorId = params.monitorId;
  if (!monitorId) {
    return {
      success: false,
      message: 'monitorId 参数不能为空',
      tooltype: 'stop_monitor',
    };
  }

  try {
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
        return {
          success: true,
          message: `监控 "${monitorId}" 已停止`,
          tooltype: 'stop_monitor',
        };
      }
      return {
        success: false,
        message: r.message || `监控未找到：${monitorId}`,
        tooltype: 'stop_monitor',
      };
    }
    return {
      success: false,
      message: `停止监控返回异常：${monitorId}`,
      tooltype: 'stop_monitor',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'stop_monitor',
    };
  }
}
