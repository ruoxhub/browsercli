/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookConsoleLog = defineTool({
  name: 'hook_console_log',
  description:
    'Hook console.log：防止网站重写 console.log 方法，保持日志输出能力',
  annotations: {
    title: 'Hook Console Log',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    mode: zod
      .enum(['proxy', 'toString', 'freeze'])
      .optional()
      .default('proxy')
      .describe(
        '防护模式：proxy=使用 Proxy 阻止重写（推荐），toString=定期检查并恢复，freeze=冻结 console 对象',
      ),
  },
  handler: async (
    request: {params: {mode?: 'proxy' | 'toString' | 'freeze'}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    void runtime;
    const mode = request.params.mode || 'proxy';

    const hookCode =
      mode === 'proxy'
        ? `
(function() {
  'use strict';
  const readonlyProps = ['log', 'trace', 'groupCollapsed', 'groupEnd'];
  const readonlyConsole = new Proxy(console, {
    set(t, k, v, r) {
      if (readonlyProps.includes(k)) {
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
      console.groupCollapsed('%c有代码试图重写console，已阻止', 'color: #ff6348;', v);
      console.trace();
      console.groupEnd();
    }
  });
  console.log('[hook_console_log] ✅ Console log protection installed (proxy mode)');
})();
`
        : mode === 'toString'
          ? `
(function() {
  'use strict';
  const tempLog = console.log;
  function judgeOverwrite() {
    if (console.log.toString() !== 'function log() { [native code] }') {
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
  Object.freeze(console);
  console.log('[hook_console_log] ✅ Console log protection installed (freeze mode)');
})();
`;

    const modeLabel =
      mode === 'proxy'
        ? 'Proxy 实时拦截'
        : mode === 'freeze'
          ? '冻结 console 对象'
          : '定期检查恢复';

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);

      response.appendResponseLine('✅ Console Log 保护已安装');
      response.appendResponseLine(`- 模式：${modeLabel}`);
      if (mode !== 'freeze') {
        response.appendResponseLine('');
        response.appendResponseLine(
          '保护范围：console.log, console.trace, console.groupCollapsed, console.groupEnd',
        );
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
