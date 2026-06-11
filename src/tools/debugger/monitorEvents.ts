/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

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

interface MonitorRecord {
  target: EventTarget;
  listeners: Record<string, EventListener>;
}

interface MonitorWindow extends Window {
  __mcp_monitors__?: Record<string, MonitorRecord>;
}

/**
 * 监控指定元素或 window 上的 DOM 事件，事件将输出到控制台。
 */
export const monitorEvents = defineTool({
  name: 'monitor_events',
  description:
    'Monitors DOM events on a specified element or window. Events will be logged to console.',
  annotations: {
    title: '监控事件',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .optional()
      .default('window')
      .describe(
        'CSS 选择器或 "window"/"document"（默认: window）.',
      ),
    events: zod
      .array(zod.string())
      .optional()
      .describe(
        '要监控的事件列表（如 ["click", "keydown"]）。不指定则监控常用事件。',
      ),
    monitorId: zod
      .string()
      .optional()
      .describe('自定义监控 ID，用于后续停止监控。'),
  },
  handler: async (request, response, context) => {
    const {selector = 'window', events, monitorId} = request.params;
    const id = monitorId || selector.replace(/[^a-zA-Z0-9]/g, '_') || 'window';
    const eventList = events || DEFAULT_EVENTS;

    try {
      const frame = (context as Context).getSelectedFrame();
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
          const browserWindow = window as unknown as MonitorWindow;

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
          response.setStructuredContent({
            success: true,
            message: `事件监控已启动：${selector}`,
            tooltype: 'monitor_events',
            data: {
              monitorId: r.monitorId ?? id,
              selector,
              eventCount: r.eventCount ?? 0,
              hint: '事件将被记录到控制台。使用 list_console_messages 查看。',
              stopCommand: `stop_monitor(monitorId: "${r.monitorId ?? id}")`
            }
          });
        } else {
          response.setStructuredContent({
            success: false,
            message: r.message || '事件监控启动失败',
            tooltype: 'monitor_events',
            data: { selector }
          });
        }
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'monitor_events',
        data: { selector: request.params.selector }
      });
    }
  },
});
