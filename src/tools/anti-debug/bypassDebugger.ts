/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from '../categories.js';
import { defineTool, type Context, type Response } from '../ToolDefinition.js';

/**
 * Bypass Debugger - 绕过无限 debugger
 *
 * Hook eval、Function、Function.prototype.constructor，移除代码中的 debugger 关键字
 */
export const bypassDebugger = defineTool({
  name: 'bypass_debugger',
  description: '绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字',
  annotations: {
    title: 'Bypass Debugger',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    targets: zod
      .array(zod.enum(['eval', 'Function', 'constructor']))
      .optional()
      .describe('要 Hook 的目标，默认全部'),
  },
  handler: async (request: { params: { targets?: Array<'eval' | 'Function' | 'constructor'> } }, response: Response, context: Context) => {
    const targets = request.params.targets || ['eval', 'Function', 'constructor'];

    const hookCode = `
(function() {
  'use strict';

  const targets = ${JSON.stringify(targets)};
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
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);

      response.appendResponseLine('✅ Bypass Debugger 已安装');
      response.appendResponseLine(`- Hook 目标：${targets.join(', ')}`);
      response.appendResponseLine('');
      response.appendResponseLine('已绕过以下无限 debugger 方式:');
      if (targets.includes('eval')) {
        response.appendResponseLine('  - eval() 中的 debugger 关键字');
      }
      if (targets.includes('Function')) {
        response.appendResponseLine('  - Function 构造器中的 debugger 关键字');
      }
      if (targets.includes('constructor')) {
        response.appendResponseLine('  - Function.prototype.constructor 中的 debugger 关键字');
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
