/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {HookResult, BypassTarget} from './types.js';

/**
 * 绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字。
 *
 * @param frame - Playwright Frame 对象，用于注入 Hook 代码
 * @param targets - 要 Hook 的目标，默认全部
 * @returns 结构化结果对象
 */
export async function bypassDebugger(
  frame: Frame,
  targets?: BypassTarget[],
): Promise<HookResult> {
  const hookTargets = targets || ['eval', 'Function', 'constructor'];

  const hookCode = `
(function() {
  'use strict';

  const targets = ${JSON.stringify(hookTargets)};
  const hookId = 'bypass_debugger';

  // Hook window.eval
  if (targets.includes('eval')) {
    const temp_eval = window.eval;
    window.eval = function() {
      if (typeof arguments[0] === 'string') {
        arguments[0] = arguments[0].replaceAll(/debugger/g, '');
      }
      return temp_eval.apply(this, arguments);
    };
    console.log('[' + hookId + '] ✅ Hooked: window.eval');
  }

  // Hook Function
  if (targets.includes('Function')) {
    const Bypass_debugger = Function;
    Function = function() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return Bypass_debugger.apply(this, arguments);
    };
    Function.prototype = Bypass_debugger.prototype;
    console.log('[' + hookId + '] ✅ Hooked: Function');
  }

  // Hook Function.prototype.constructor
  if (targets.includes('constructor')) {
    const Bypass_debugger = Function;
    Function.prototype.constructor = function() {
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'string') {
          arguments[i] = arguments[i].replaceAll(/debugger/g, '');
        }
      }
      return Bypass_debugger.apply(this, arguments);
    };
    Function.prototype.constructor.prototype = Function.prototype;
    console.log('[' + hookId + '] ✅ Hooked: Function.prototype.constructor');
  }

  console.log('[' + hookId + '] ✅ All debugger bypass hooks installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: `Bypass Debugger 已安装，Hook 目标：${hookTargets.join(', ')}`,
      tooltype: 'bypass_debugger',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'bypass_debugger',
    };
  }
}
