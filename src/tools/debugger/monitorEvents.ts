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

  try {
    const result = await frame.evaluate(
      ({
        selector,
        events,
        monitorId,
      }: {
        selector: string;
        events: string[];
        monitorId: string;
      }) => {
        const browserWindow = window as typeof window & {
          __mcp_monitors__?: Record<
            string,
            {
              target: EventTarget;
              listeners: Record<string, EventListener>;
            }
          >;
        };

        browserWindow.__mcp_monitors__ = browserWindow.__mcp_monitors__ || {};
        if (browserWindow.__mcp_monitors__[monitorId]) {
          return {success: false, message: `Monitor already exists: ${monitorId}`};
        }

        let target: EventTarget | null;
        if (selector === 'window') {
          target = window;
        } else if (selector === 'document') {
          target = document;
        } else {
          target = document.querySelector(selector);
          if (!target) {
            return {success: false, message: `Element not found: ${selector}`};
          }
        }

        const listeners: Record<string, EventListener> = {};

        events.forEach(eventType => {
          const handler: EventListener = event => {
            const typedEvent = event as Event & {
              target?: EventTarget & {
                tagName?: string;
                id?: string;
                className?: string;
              };
              key?: string;
              code?: string;
              clientX?: number;
              clientY?: number;
            };
            const info: Record<string, unknown> = {
              monitor: monitorId,
              event: eventType,
              timestamp: new Date().toISOString(),
              target: typedEvent.target?.tagName || 'unknown',
            };

            if (typedEvent.target?.id) info.targetId = typedEvent.target.id;
            if (typedEvent.target?.className) {
              info.targetClass = typedEvent.target.className;
            }
            if (typedEvent.key) info.key = typedEvent.key;
            if (typedEvent.code) info.code = typedEvent.code;
            if (typedEvent.clientX !== undefined) {
              info.position = {x: typedEvent.clientX, y: typedEvent.clientY};
            }

            console.log('[MCP Event]', info);
          };

          target.addEventListener(eventType, handler, true);
          listeners[eventType] = handler;
        });

        browserWindow.__mcp_monitors__[monitorId] = {target, listeners};

        return {success: true, monitorId, eventCount: events.length};
      },
      {selector, events: eventList, monitorId: id},
    );

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
