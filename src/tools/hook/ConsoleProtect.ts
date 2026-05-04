/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * 保护 console：防止代码重写 console.log/trace/groupCollapsed/groupEnd 等方法。
 */
export const hookConsoleProtect = defineTool({
  name: 'hook_console_protect',
  description:
    'Protect console methods (log/trace/groupCollapsed/groupEnd) from being overwritten by website code.',
  annotations: {
    title: 'Hook Console Protect',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    protectedMethods: zod
      .array(zod.string())
      .optional()
      .describe(
        'Method names to protect, default: log, trace, groupCollapsed, groupEnd',
      ),
  },
  handler: async (request, response, context) => {
    const {protectedMethods} = request.params;
    const methods = protectedMethods || [
      'log',
      'trace',
      'groupCollapsed',
      'groupEnd',
    ];
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
  const protectedMethods = ${JSON.stringify(methods)};
${buildHookStoreRuntime({
  hookId: 'hook_console_protect',
  type: 'console',
  target: 'window.console',
})}

  // Save original references BEFORE proxying to avoid recursion in the trap
  const origConsole = console;
  const origGroupCollapsed = console.groupCollapsed;
  const origTrace = console.trace;
  const origGroupEnd = console.groupEnd;

  const readonlyConsole = new Proxy(origConsole, {
    set(t, k, v, r) {
      if (protectedMethods.includes(k)) {
        __pushHookRecord({
          event: 'overwrite_blocked',
          method: String(k),
          value: __cloneHookValue(v),
        });
        origGroupCollapsed.call(origConsole, '%c有代码试图重写 console.' + k + ' 方法，已阻止', 'color: #ff6348;', v);
        origTrace.call(origConsole);
        origGroupEnd.call(origConsole);
        return true;
      }
      return Reflect.set(t, k, v, r);
    }
  });

  Object.defineProperty(window, 'console', {
    configurable: true,
    enumerable: false,
    get: function() {
      return readonlyConsole;
    },
    set: function(v) {
      __pushHookRecord({
        event: 'console_overwrite_blocked',
        value: __cloneHookValue(v),
      });
      origGroupCollapsed.call(origConsole, '%c有代码试图重写 console，已阻止', 'color: #ff6348;', v);
      origTrace.call(origConsole);
      origGroupEnd.call(origConsole);
    }
  });

  origConsole.log('[hook_console_protect] ✅ Console protected: ' + protectedMethods.join(', '));
})();
`;

    try {
      await frame.evaluate(hookCode);
      const result = {
        success: true,
        message: `Console 保护 Hook 已安装，保护方法：${methods.join(', ')}`,
        tooltype: 'hook_console_protect',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_console_protect',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
