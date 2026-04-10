/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookConsoleProtect = defineTool({
  name: 'hook_console_protect',
  description:
    '保护 console：防止代码重写 console.log/trace/groupCollapsed/groupEnd 等方法',
  annotations: {
    title: 'Hook Console Protect',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    protectedMethods: zod
      .array(zod.string())
      .optional()
      .default(['log', 'trace', 'groupCollapsed', 'groupEnd'])
      .describe('要保护的方法名列表'),
  },
  handler: async (
    request: {
      params: {
        protectedMethods?: string[];
      };
    },
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const {protectedMethods} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const protectedMethods = ${JSON.stringify(protectedMethods || ['log', 'trace', 'groupCollapsed', 'groupEnd'])};

  // Save original references BEFORE proxying to avoid recursion in the trap
  const origConsole = console;
  const origGroupCollapsed = console.groupCollapsed;
  const origTrace = console.trace;
  const origGroupEnd = console.groupEnd;

  const readonlyConsole = new Proxy(origConsole, {
    set(t, k, v, r) {
      if (protectedMethods.includes(k)) {
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
      origGroupCollapsed.call(origConsole, '%c有代码试图重写 console，已阻止', 'color: #ff6348;', v);
      origTrace.call(origConsole);
      origGroupEnd.call(origConsole);
    }
  });

  origConsole.log('[hook_console_protect] ✅ Console protected: ' + protectedMethods.join(', '));
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Console 保护 Hook 已安装');
      response.appendResponseLine(
        `- 保护方法：${protectedMethods!.join(', ')}`,
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
