/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AntiAntiDebugFeature, BypassTarget} from './types.js';

/** 浏览器端 hook 共用的命名空间前缀 */
const HOOK_TAG = 'anti_anti_debug';

/** anti_anti_debug 启用的窗口尺寸默认值 */
const DEFAULT_INNER_WIDTH = 1366;
const DEFAULT_INNER_HEIGHT = 660;
const DEFAULT_OUTER_WIDTH = 1400;
const DEFAULT_OUTER_HEIGHT = 760;

/**
 * 固定窗口尺寸的 hook。
 */
const FIXED_WINDOW_SIZE_HOOK = `
(function() {
  'use strict';
  Object.defineProperties(window, {
    innerWidth: { value: ${DEFAULT_INNER_WIDTH}, writable: false, configurable: true },
    innerHeight: { value: ${DEFAULT_INNER_HEIGHT}, writable: false, configurable: true },
    outerWidth: { value: ${DEFAULT_OUTER_WIDTH}, writable: false, configurable: true },
    outerHeight: { value: ${DEFAULT_OUTER_HEIGHT}, writable: false, configurable: true },
  });
  console.log('[${HOOK_TAG}] ✅ Fixed window size');
})();
`;

/**
 * 固定 Date.now / performance.now 的 hook。
 */
const FIXED_TIME_HOOK = `
(function() {
  'use strict';
  if (typeof performance !== 'undefined' && performance.now) {
    performance.now = () => 0;
    console.log('[${HOOK_TAG}] ✅ Fixed performance.now()');
  }
  Date.now = () => 0;
  console.log('[${HOOK_TAG}] ✅ Fixed Date.now()');
})();
`;

/**
 * 阻止 window.close 的 hook。
 */
const PREVENT_CLOSE_HOOK = `
(function() {
  'use strict';
  window.close = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: window.close()');
  };
  console.log('[${HOOK_TAG}] ✅ Blocked window.close');
})();
`;

/**
 * 阻止 history.back / history.go 的 hook。
 */
const PREVENT_HISTORY_BACK_HOOK = `
(function() {
  'use strict';
  const originalHistory = window.history;
  originalHistory.back = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: history.back()');
  };
  originalHistory.go = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: history.go()');
  };
  console.log('[${HOOK_TAG}] ✅ Blocked history navigation');
})();
`;

/**
 * 阻止 console.clear 的 hook。
 */
const PREVENT_CONSOLE_CLEAR_HOOK = `
(function() {
  'use strict';
  console.clear = function() {
    console.log('[${HOOK_TAG}] ⛔ Blocked: console.clear()');
  };
  console.log('[${HOOK_TAG}] ✅ Blocked console.clear');
})();
`;

/**
 * 隐藏 navigator.webdriver 的 hook。
 */
const HIDE_WEBDRIVER_HOOK = `
(function() {
  'use strict';
  if (navigator.webdriver !== undefined) {
    Object.defineProperty(navigator, 'webdriver', {
      get: function() { return false; },
      configurable: true
    });
    console.log('[${HOOK_TAG}] ✅ Hidden navigator.webdriver');
  }
})();
`;

/** 特性 → 浏览器端 hook 脚本 的映射。 */
const ANTI_ANTI_DEBUG_HOOKS: Record<AntiAntiDebugFeature, string> = {
  fixedWindowSize: FIXED_WINDOW_SIZE_HOOK,
  fixedTime: FIXED_TIME_HOOK,
  preventClose: PREVENT_CLOSE_HOOK,
  preventHistoryBack: PREVENT_HISTORY_BACK_HOOK,
  preventConsoleClear: PREVENT_CONSOLE_CLEAR_HOOK,
  hideWebdriver: HIDE_WEBDRIVER_HOOK,
};

/**
 * 将勾选的 anti_anti_debug 特性拼接成一段可在页面执行的脚本。
 */
export function buildAntiAntiDebugScript(
  features: readonly AntiAntiDebugFeature[],
): string {
  return features.map(feature => ANTI_ANTI_DEBUG_HOOKS[feature]).join('\n');
}

/**
 * bypass_debugger 注入脚本：移除 eval/Function/constructor 字符串中的 `debugger` 关键字。
 */
export function buildBypassDebuggerScript(
  targets: readonly BypassTarget[],
): string {
  const mutableTargets: BypassTarget[] = [...targets];
  return `
(function() {
  'use strict';

  const targets = ${JSON.stringify(mutableTargets)};
  const hookId = 'bypass_debugger';

  if (targets.includes('eval')) {
    const originalEval = window.eval;
    window.eval = function() {
      if (typeof arguments[0] === 'string') {
        arguments[0] = arguments[0].replaceAll(/debugger/g, '');
      }
      return originalEval.apply(this, arguments);
    };
    console.log('[' + hookId + '] ✅ Hooked: window.eval');
  }

  if (targets.includes('Function')) {
    const originalFunction = Function;
    function BypassedFunction() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return originalFunction.apply(this, arguments);
    }
    BypassedFunction.prototype = originalFunction.prototype;
    // 兼容通过 window.Function 调用的场景
    Object.setPrototypeOf(BypassedFunction, originalFunction);
    window.Function = BypassedFunction as unknown as FunctionConstructor;
    console.log('[' + hookId + '] ✅ Hooked: Function');
  }

  if (targets.includes('constructor')) {
    const originalFunction = Function;
    function BypassedConstructor() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return originalFunction.apply(this, arguments);
    }
    BypassedConstructor.prototype = Function.prototype;
    Function.prototype.constructor = BypassedConstructor as unknown as FunctionConstructor;
    console.log('[' + hookId + '] ✅ Hooked: Function.prototype.constructor');
  }

  console.log('[' + hookId + '] ✅ All debugger bypass hooks installed');
})();
`;
}
