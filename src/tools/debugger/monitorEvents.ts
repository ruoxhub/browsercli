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
 */
export const monitorEvents = defineTool({
  name: 'monitor_events',
  description: '监控指定元素或 window 上的 DOM 事件，事件将输出到控制台。',
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
      .describe('CSS 选择器或 "window"/"document"（默认: window）.'),
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

    await evaluateAndRespond<{
      error?: string;
      monitorId?: string;
      eventCount?: number;
    }>({
      context: context as Context,
      response,
      tooltype: 'monitor_events',
      evaluate: frame =>
        frame.evaluate(
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

            browserWindow.__mcp_monitors__ =
              browserWindow.__mcp_monitors__ || {};
            if (browserWindow.__mcp_monitors__[monitorId]) {
              return {
                error: `Monitor already exists: ${monitorId}`,
              };
            }

            let target: EventTarget | null;
            if (selector === 'window') {
              target = window;
            } else if (selector === 'document') {
              target = document;
            } else {
              target = document.querySelector(selector);
              if (!target) {
                return {
                  error: `Element not found: ${selector}`,
                };
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
                  info.position = {
                    x: typedEvent.clientX,
                    y: typedEvent.clientY,
                  };
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
        ),
      onSuccess: result => {
        response.setStructuredContent({
          success: true,
          message: `事件监控已启动：${selector}`,
          tooltype: 'monitor_events',
          data: {
            monitorId: result.monitorId ?? id,
            selector,
            eventCount: result.eventCount ?? 0,
            hint: '事件将被记录到控制台。使用 list_console_messages 查看。',
            stopCommand: `stop_monitor(monitorId: "${result.monitorId ?? id}")`,
          },
        });
      },
      onEvaluateFail: () => {
        throw createToolError(
          ErrorCodes.RUNTIME,
          '事件监控启动失败',
          {toolName: 'monitor_events', selector},
        );
      },
    });
  },
});
