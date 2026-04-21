/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookFunctionParams, HookFunctionResult} from './types.js';

/**
 * Hook 一个 JavaScript 函数，监控其调用、参数和返回值，不暂停执行。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param params - Hook 参数
 * @returns 结构化结果对象
 */
export async function hookFunction(
  frame: Frame,
  params: HookFunctionParams,
): Promise<HookFunctionResult> {
  const {target, logArgs = true, logResult = true, logStack = false, hookId} =
    params;
  const id = hookId || target.replace(/[^a-zA-Z0-9]/g, '_');

  // Split target into object path and method
  const parts = target.split('.');
  const methodName = parts.pop()!;
  const objectPath = parts.length > 0 ? parts.join('.') : 'window';

  const hookCode = `
(function() {
  const hookId = ${JSON.stringify(id)};
  const objectPath = ${JSON.stringify(objectPath)};
  const methodName = ${JSON.stringify(methodName)};
  const logArgs = ${logArgs};
  const logResult = ${logResult};
  const logStack = ${logStack};

  // Get the object
  let obj;
  try {
    obj = objectPath === 'window' ? window : eval(objectPath);
  } catch(e) {
    throw new Error('Cannot find object: ' + objectPath);
  }

  if (!obj || typeof obj[methodName] !== 'function') {
    throw new Error('Cannot find function: ' + methodName + ' on ' + objectPath);
  }

  // Store original and hooks registry
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

  // Create hooked function
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

      // Handle promises
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

  // Preserve function properties
  Object.keys(original).forEach(key => {
    try { obj[methodName][key] = original[key]; } catch(e) {}
  });

  return { success: true, hookId: hookId };
})();
`;

  try {
    const result = await frame.evaluate(hookCode);

    if (result && typeof result === 'object') {
      const r = result as {success: boolean; hookId?: string; message?: string};
      if (r.success) {
        return {
          success: true,
          message: `Hook 已安装：${target} (id: ${r.hookId ?? id})`,
          tooltype: 'hook_function',
          logFormat: 'full',
          data: {hookId: r.hookId ?? id, target},
        };
      }
      return {
        success: false,
        message: r.message || `Hook 安装失败：${target}`,
        tooltype: 'hook_function',
      };
    }
    return {
      success: false,
      message: `Hook 安装返回异常：${target}`,
      tooltype: 'hook_function',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_function',
    };
  }
}
