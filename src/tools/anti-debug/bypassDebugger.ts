/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import type {BypassTarget} from './types.js';

/**
 * 绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字。
 */
export const bypassDebugger = defineTool({
  name: 'bypass_debugger',
  description:
    'Bypass infinite debugger statements by removing debugger keywords from eval/Function/constructor.',
  annotations: {
    title: 'Bypass Debugger',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    targets: zod
      .array(zod.enum(['eval', 'Function', 'constructor'] as const))
      .optional()
      .describe(
        'Targets to hook. Defaults to all: ["eval", "Function", "constructor"]',
      ),
  },
  handler: async (request, response, context) => {
    const {targets} = request.params;
    const hookTargets: BypassTarget[] =
      targets && targets.length > 0 ? targets : ['eval', 'Function', 'constructor'];
    const frame = (context as Context).getSelectedFrame();

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
      const result = {
        success: true,
        message: `Bypass Debugger 已安装，Hook 目标：${hookTargets.join(', ')}`,
        tooltype: 'bypass_debugger',
      };
      // response.appendResponseLine('```json');
      // response.appendResponseLine(JSON.stringify(result, null, 2));
      // response.appendResponseLine('```');
      response.setStructuredContent(result);
    } catch (error) {
      const result = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'bypass_debugger',
      };
      // response.appendResponseLine('```json');
      // response.appendResponseLine(JSON.stringify(result, null, 2));
      // response.appendResponseLine('```');
      response.setStructuredContent(result);
    }
  },
});
