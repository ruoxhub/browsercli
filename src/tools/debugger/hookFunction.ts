/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {evaluateAndRespond} from './evaluateAndRespond.js';
import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

/**
 * Hook 一个 JavaScript 函数，监控其调用、参数和返回值，不暂停执行。
 */
export const hookFunction = defineTool({
  name: 'hook_function',
  description:
    '逆向工程推荐工具：Hook 一个 JavaScript 函数，记录其调用、参数与返回值，且不暂停执行。相比断点更适用于自动化工作流，建议作为监控函数的默认手段。',
  annotations: {
    title: 'Hook Function',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    target: zod
      .string()
      .describe(
        '要 Hook 的函数。可为：全局函数名（"fetch"）、对象方法（"XMLHttpRequest.prototype.open"）或路径（"window.app.api.request"）。',
      ),
    logArgs: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否记录函数参数（默认 true）。'),
    logResult: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否记录返回值（默认 true）。'),
    logStack: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否记录调用栈（默认 false）。'),
    hookId: zod
      .string()
      .optional()
      .describe(
        '本 Hook 的自定义标识，用于后续解除 Hook，默认取 target 名称。',
      ),
  },
  handler: async (request, response, context) => {
    const {
      target,
      logArgs = true,
      logResult = true,
      logStack = false,
      hookId,
    } = request.params;

    const id = hookId || target.replace(/[^a-zA-Z0-9]/g, '_');
    const parts = target.split('.');
    const methodName = parts.pop()!;
    const objectPath = parts.length > 0 ? parts.join('.') : 'window';

    await evaluateAndRespond<{
      success: boolean;
      hookId?: string;
      message?: string;
    }>({
      context: context as Context,
      response,
      tooltype: 'hook_function',
      evaluate: frame =>
        evaluateInPageRuntime(
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

  const buildRecord = (event, extra) => ({
    hook: hookId,
    target: objectPath + '.' + methodName,
    timestamp: Date.now(),
    isoTime: new Date().toISOString(),
    event,
    ...extra,
  });

  const report = (event, extra, flag) => {
    const record = buildRecord(event, extra);
    if (flag) pushHookData(record);
    console.log('[MCP Hook ' + event + ']', record);
  };

  const __reentryFlag = '__mcp_reentry_' + hookId;
  obj[methodName] = function(...args) {
    // 重入防护：当本 Hook 自身（或其内部日志调用）再次触发目标函数时，
    // 直接走原始实现，避免 console.log 等被 Hook 后无限递归爆栈。
    if (obj[__reentryFlag]) {
      return original.apply(this, args);
    }
    obj[__reentryFlag] = true;
    try {
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
          report('result', {result: safeClone(res)}, logResult);
          return res;
        }).catch(err => {
          report('error', {error: err && err.message ? err.message : String(err)}, true);
          throw err;
        });
      }

      report('result', {result: safeClone(result)}, logResult);
      return result;
    } catch(err) {
      report('error', {error: err && err.message ? err.message : String(err)}, true);
      throw err;
    }
    } finally {
      obj[__reentryFlag] = false;
    }
  };

  Object.keys(original).forEach(key => {
    try { obj[methodName][key] = original[key]; } catch(e) {}
  });

  return { success: true, hookId: hookId };
})();
`,
        ),
      onSuccess: result => {
        response.setStructuredContent({
          success: true,
          message: `Hook 已安装：${target}`,
          tooltype: 'hook_function',
          data: {
            hookId: result.hookId ?? id,
            target,
            logArgs,
            logResult,
            logStack,
            hint: '函数调用将被记录到控制台。使用 list_console_messages 查看。',
            unhookCommand: `unhook_function(hookId: "${result.hookId ?? id}")`,
          },
        });
      },
      onEvaluateFail: () => {
        response.setStructuredContent({
          success: false,
          message: 'Hook 安装失败',
          tooltype: 'hook_function',
          data: {target},
        });
      },
    });
  },
});
