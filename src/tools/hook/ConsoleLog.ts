/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult, ConsoleProtectMode} from './types.js';

/**
 * Hook console.log：防止网站重写 console.log 方法，保持日志输出能力。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param mode - 防护模式：proxy/toString/freeze，默认 proxy
 * @returns 结构化结果对象
 */
export async function hookConsoleLog(
  frame: Frame,
  mode?: ConsoleProtectMode,
): Promise<HookResult> {
  const protectMode = mode || 'proxy';

  const hookCode =
    protectMode === 'proxy'
      ? `
(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_console_log',
  type: 'console',
  target: 'window.console',
})}
  const readonlyProps = ['log', 'trace', 'groupCollapsed', 'groupEnd'];
  const readonlyConsole = new Proxy(console, {
    set(t, k, v, r) {
      if (readonlyProps.includes(k)) {
        __pushHookRecord({
          event: 'overwrite_blocked',
          mode: 'proxy',
          method: String(k),
          value: __cloneHookValue(v),
        });
        console.groupCollapsed('%c有代码试图重写console.' + k + '方法，已阻止', 'color: #ff6348;', v);
        console.trace();
        console.groupEnd();
        return true;
      }
      return Reflect.set(t, k, v, r);
    }
  });
  Object.defineProperty(window, 'console', {
    configurable: true,
    enumerable: false,
    get: function() { return readonlyConsole; },
    set: function(v) {
      __pushHookRecord({
        event: 'console_overwrite_blocked',
        mode: 'proxy',
        value: __cloneHookValue(v),
      });
      console.groupCollapsed('%c有代码试图重写console，已阻止', 'color: #ff6348;', v);
      console.trace();
      console.groupEnd();
    }
  });
  console.log('[hook_console_log] ✅ Console log protection installed (proxy mode)');
})();
`
      : protectMode === 'toString'
        ? `
(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_console_log',
  type: 'console',
  target: 'console.log',
})}
  const tempLog = console.log;
  function judgeOverwrite() {
    if (console.log.toString() !== 'function log() { [native code] }') {
      __pushHookRecord({
        event: 'overwrite_restored',
        mode: 'toString',
      });
      console.log = tempLog;
      console.log('[hook_console_log] ⚠️ console.log was overwritten, restored');
    }
  }
  window.addEventListener('load', () => { judgeOverwrite(); });
  setTimeout(() => { judgeOverwrite(); }, 3000);
  console.log('[hook_console_log] ✅ Console log protection installed (toString mode)');
})();
`
        : `
(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_console_log',
  type: 'console',
  target: 'console.log',
})}
  Object.freeze(console);
  __pushHookRecord({
    event: 'freeze_enabled',
    mode: 'freeze',
  });
  console.log('[hook_console_log] ✅ Console log protection installed (freeze mode)');
})();
`;

  const modeLabel =
    protectMode === 'proxy'
      ? 'Proxy 实时拦截'
      : protectMode === 'freeze'
        ? '冻结 console 对象'
        : '定期检查恢复';

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: `Console Log 保护已安装，模式：${modeLabel}`,
      tooltype: 'hook_console_log',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_console_log',
    };
  }
}
