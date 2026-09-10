/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
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
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。保留值: "window" 与 "document"（默认: window）。',
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

    await evaluateAndRespond<{
      error?: string;
      monitorId?: string;
      eventCount?: number;
    }>({
      context: context as Context,
      response,
      tooltype: 'monitor_events',
      evaluate: async frame => {
        const installScript = `
          (target, monitorId, events) => {
            const browserWindow = window;
            browserWindow.__mcp_monitors__ = browserWindow.__mcp_monitors__ || {};
            if (browserWindow.__mcp_monitors__[monitorId]) {
              return { error: 'Monitor already exists: ' + monitorId };
            }
            const listeners = {};
            events.forEach(eventType => {
              const handler = event => {
                const info = {
                  monitor: monitorId,
                  event: eventType,
                  timestamp: new Date().toISOString(),
                  target: (event.target && event.target.tagName) || 'unknown',
                };
                if (event.target && event.target.id) info.targetId = event.target.id;
                if (event.target && event.target.className) info.targetClass = event.target.className;
                if (event.key) info.key = event.key;
                if (event.code) info.code = event.code;
                if (event.clientX !== undefined) {
                  info.position = { x: event.clientX, y: event.clientY };
                }
                console.log('[MCP Event]', info);
              };
              target.addEventListener(eventType, handler, true);
              listeners[eventType] = handler;
            });
            browserWindow.__mcp_monitors__[monitorId] = {target, listeners};
            return {success: true, monitorId, eventCount: events.length};
          }
        `;

        if (selector === 'window') {
          return await frame.evaluate(
            ({fn, monitorId, events}) => {
              // eslint-disable-next-line no-eval
              const installer = eval(fn);
              return installer(window, monitorId, events);
            },
            {fn: installScript, monitorId: id, events: eventList},
          );
        }

        if (selector === 'document') {
          return await frame.evaluate(
            ({fn, monitorId, events}) => {
              // eslint-disable-next-line no-eval
              const installer = eval(fn);
              return installer(document, monitorId, events);
            },
            {fn: installScript, monitorId: id, events: eventList},
          );
        }

        const loc = frame.locator(selector);
        try {
          const count = await loc.count();
          if (count === 0) {
            return {
              error: `Element not found: ${selector}`,
            };
          }

          return await loc.evaluate(
            (target, {fn, monitorId, events}) => {
              // eslint-disable-next-line no-eval
              const installer = eval(fn);
              return installer(target, monitorId, events);
            },
            {fn: installScript, monitorId: id, events: eventList},
          );
        } catch (error) {
          throw toElementError(error, {toolName: 'monitor_events', selector});
        }
      },
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
        throw createToolError(ErrorCodes.RUNTIME, '事件监控启动失败', {
          toolName: 'monitor_events',
          selector,
        });
      },
    });
  },
});
