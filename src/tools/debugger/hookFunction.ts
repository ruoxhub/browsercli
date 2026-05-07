/**
 * @license`
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

/**
 * Hook 一个 JavaScript 函数，监控其调用、参数和返回值，不暂停执行。
 */
export const hookFunction = defineTool({
  name: 'hook_function',
  description:
    'RECOMMENDED for reverse engineering: Hooks a JavaScript function to log its calls, arguments, and return values without pausing execution. More reliable than breakpoints for automated workflows. Use this as the default approach for monitoring functions.',
  annotations: {
    title: 'Hook Function',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    target: zod
      .string()
      .describe(
        'The function to hook. Can be: global function name ("fetch"), object method ("XMLHttpRequest.prototype.open"), or path ("window.app.api.request").',
      ),
    logArgs: zod
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to log function arguments (default: true).'),
    logResult: zod
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to log return value (default: true).'),
    logStack: zod
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to log call stack (default: false).'),
    hookId: zod
      .string()
      .optional()
      .describe(
        'Custom identifier for this hook. Used to unhook later. Defaults to target name.',
      ),
  },
  handler: async (request, response, context) => {
    const {target, logArgs = true, logResult = true, logStack = false, hookId} =
      request.params;

    if (!target || typeof target !== 'string') {
      response.setStructuredContent({
        success: false,
        message: 'hook_function requires a "target" string parameter (e.g. "XMLHttpRequest.prototype.open")',
        tooltype: 'hook_function',
        data: {}
      });
      return;
    }

    const id = hookId || target.replace(/[^a-zA-Z0-9]/g, '_');
    // Split target into object path and method
    const parts = target.split('.');
    const methodName = parts.pop()!;
    const objectPath = parts.length > 0 ? parts.join('.') : 'window';

    try {
      const frame = (context as Context).getSelectedFrame();
      if (!frame) {
        response.setStructuredContent({
          success: false,
          message: '当前没有可用的页面或 Frame',
          tooltype: 'hook_function',
          data: {}
        });
        return;
      }

      const result = await evaluateInPageRuntime(
        frame,
        `
(function() {
  const hookId = ${JSON.stringify(id)};
  const objectPath = ${JSON.stringify(objectPath)};
  const methodName = ${JSON.stringify(methodName)};
  const logArgs = ${logArgs};
  const logResult = ${logResult};
  const logStack = ${logStack};

  let obj;
  try {
    obj = objectPath === 'window' ? window : (0, eval)(objectPath);
  } catch (e) {
    throw new Error('Cannot find object: ' + objectPath);
  }

  if (!obj || typeof obj[methodName] !== 'function') {
    throw new Error('Cannot find function: ' + methodName + ' on ' + objectPath);
  }

  window.__mcp_hooks__ = window.__mcp_hooks__ || {};
  window.__hookStore = window.__hookStore || {};
  if (window.__mcp_hooks__[hookId]) {
    return { success: false, message: 'Hook already exists with id: ' + hookId };
  }
  if (!window.__hookStore[hookId]) {
    window.__hookStore[hookId] = [];
  }

  const original = obj[methodName];
  window.__mcp_hooks__[hookId] = { obj, methodName, original };

  const safeClone = (value) => {
    try {
      if (typeof value === 'function') return '[Function]';
      if (typeof Element !== 'undefined' && value instanceof Element) {
        return '[Element: ' + value.tagName + ']';
      }
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      try {
        return String(value);
      } catch {
        return '[Unserializable]';
      }
    }
  };

  const pushHookData = (record) => {
    const store = window.__hookStore[hookId];
    if (!Array.isArray(store)) return;
    store.push(record);
    if (store.length > 1000) store.shift();
  };

  obj[methodName] = function(...args) {
    const callInfo = {
      hook: hookId,
      target: objectPath + '.' + methodName,
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      event: 'call',
    };

    if (logArgs) {
      callInfo.arguments = args.map(arg => safeClone(arg));
    }

    if (logStack) {
      callInfo.stack = new Error().stack?.split('\\n').slice(2, 6).map(s => s.trim());
    }

    pushHookData(callInfo);
    console.log('[MCP Hook]', callInfo);

    try {
      const result = original.apply(this, args);

      if (result && typeof result.then === 'function') {
        return result.then(res => {
          if (logResult) {
            const resInfo = safeClone(res);
            const resultInfo = {
              hook: hookId,
              target: objectPath + '.' + methodName,
              timestamp: Date.now(),
              isoTime: new Date().toISOString(),
              event: 'result',
              result: resInfo,
            };
            pushHookData(resultInfo);
            console.log('[MCP Hook Result]', { hook: hookId, result: resInfo });
          }
          return res;
        }).catch(err => {
          const errorInfo = {
            hook: hookId,
            target: objectPath + '.' + methodName,
            timestamp: Date.now(),
            isoTime: new Date().toISOString(),
            event: 'error',
            error: err && err.message ? err.message : String(err),
          };
          pushHookData(errorInfo);
          console.log('[MCP Hook Error]', { hook: hookId, error: err.message });
          throw err;
        });
      }

      if (logResult) {
        const resInfo = safeClone(result);
        const resultInfo = {
          hook: hookId,
          target: objectPath + '.' + methodName,
          timestamp: Date.now(),
          isoTime: new Date().toISOString(),
          event: 'result',
          result: resInfo,
        };
        pushHookData(resultInfo);
        console.log('[MCP Hook Result]', { hook: hookId, result: resInfo });
      }

      return result;
    } catch(err) {
      const errorInfo = {
        hook: hookId,
        target: objectPath + '.' + methodName,
        timestamp: Date.now(),
        isoTime: new Date().toISOString(),
        event: 'error',
        error: err && err.message ? err.message : String(err),
      };
      pushHookData(errorInfo);
      console.log('[MCP Hook Error]', { hook: hookId, error: err.message });
      throw err;
    }
  };

  Object.keys(original).forEach(key => {
    try { obj[methodName][key] = original[key]; } catch(e) {}
  });

  return { success: true, hookId: hookId };
})();
`,
      );

      if (result && typeof result === 'object') {
        const r = result as {success: boolean; hookId?: string; message?: string};
        if (r.success) {
          response.setStructuredContent({
            success: true,
            message: `Hook 已安装：${target}`,
            tooltype: 'hook_function',
            data: {
              hookId: r.hookId ?? id,
              target,
              logArgs,
              logResult,
              logStack,
              hint: '函数调用将被记录到控制台。使用 list_console_messages 查看。',
              unhookCommand: `unhook_function(hookId: "${r.hookId ?? id}")`
            }
          });
        } else {
          response.setStructuredContent({
            success: false,
            message: r.message || 'Hook 安装失败',
            tooltype: 'hook_function',
            data: { target }
          });
        }
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_function',
        data: { target }
      });
    }
  },
});
