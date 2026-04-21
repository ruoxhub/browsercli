/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * 保护 console：防止代码重写 console.log/trace/groupCollapsed/groupEnd 等方法。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param protectedMethods - 要保护的方法名列表
 * @returns 结构化结果对象
 */
export async function hookConsoleProtect(
  frame: Frame,
  protectedMethods?: string[],
): Promise<HookResult> {
  const methods = protectedMethods || ['log', 'trace', 'groupCollapsed', 'groupEnd'];

  const hookCode = `
(function() {
  'use strict';
  const protectedMethods = ${JSON.stringify(methods)};

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
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: `Console 保护 Hook 已安装，保护方法：${methods.join(', ')}`,
      tooltype: 'hook_console_protect',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_console_protect',
    };
  }
}
