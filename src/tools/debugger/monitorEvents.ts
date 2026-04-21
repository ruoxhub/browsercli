/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {MonitorEventsParams, MonitorEventsResult} from './types.js';

const DEFAULT_EVENTS = [
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'keydown',
  'keyup',
  'keypress',
  'submit',
  'change',
  'input',
  'focus',
  'blur',
];

/**
 * 监控指定元素或 window 上的 DOM 事件，事件将输出到控制台。
 *
 * @param frame - Puppeteer Frame 对象
 * @param params - 监控参数
 * @returns 结构化结果对象
 */
export async function monitorEvents(
  frame: Frame,
  params: MonitorEventsParams = {},
): Promise<MonitorEventsResult> {
  const {selector = 'window', events, monitorId} = params;
  const id = monitorId || selector.replace(/[^a-zA-Z0-9]/g, '_') || 'window';
  const eventList = events || DEFAULT_EVENTS;

  const monitorCode = `
(function() {
  const selector = ${JSON.stringify(selector)};
  const events = ${JSON.stringify(eventList)};
  const monitorId = ${JSON.stringify(id)};

  window.__mcp_monitors__ = window.__mcp_monitors__ || {};
  if (window.__mcp_monitors__[monitorId]) {
    return { success: false, message: 'Monitor already exists: ' + monitorId };
  }

  let target;
  if (selector === 'window') {
    target = window;
  } else if (selector === 'document') {
    target = document;
  } else {
    target = document.querySelector(selector);
    if (!target) {
      return { success: false, message: 'Element not found: ' + selector };
    }
  }

  const listeners = {};

  events.forEach(eventType => {
    const handler = (e) => {
      const info = {
        monitor: monitorId,
        event: eventType,
        timestamp: new Date().toISOString(),
        target: e.target?.tagName || 'unknown',
      };

      if (e.target?.id) info.targetId = e.target.id;
      if (e.target?.className) info.targetClass = e.target.className;
      if (e.key) info.key = e.key;
      if (e.code) info.code = e.code;
      if (e.clientX !== undefined) info.position = { x: e.clientX, y: e.clientY };

      console.log('[MCP Event]', info);
    };

    target.addEventListener(eventType, handler, true);
    listeners[eventType] = handler;
  });

  window.__mcp_monitors__[monitorId] = { target, listeners };

  return { success: true, monitorId, eventCount: events.length };
})();
`;

  try {
    const result = await frame.evaluate(monitorCode);

    if (result && typeof result === 'object') {
      const r = result as {
        success: boolean;
        monitorId?: string;
        eventCount?: number;
        message?: string;
      };
      if (r.success) {
        return {
          success: true,
          message: `事件监控已启动：${selector} (${r.eventCount} 个事件类型)`,
          tooltype: 'monitor_events',
          logFormat: 'full',
          data: {monitorId: r.monitorId ?? id, eventCount: r.eventCount ?? 0},
        };
      }
      return {
        success: false,
        message: r.message || '事件监控启动失败',
        tooltype: 'monitor_events',
      };
    }
    return {
      success: false,
      message: '事件监控返回异常',
      tooltype: 'monitor_events',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'monitor_events',
    };
  }
}
