/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {buildBypassDebuggerScript} from './hooks.js';
import {runHook} from './result.js';
import {
  BYPASS_DEBUGGER_TOOLTYPE,
  bypassTargetSchema,
  DEFAULT_BYPASS_TARGETS,
} from './schema.js';
import type {BypassTarget} from './types.js';

/**
 * 绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字。
 */
export const bypassDebugger = defineTool({
  name: 'bypass_debugger',
  description:
    '通过移除 eval/Function/constructor 中的 debugger 关键字来绕过无限 debugger 语句。',
  annotations: {
    title: 'Bypass Debugger',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    targets: zod
      .array(bypassTargetSchema)
      .optional()
      .describe(
        '要 Hook 的目标，默认为全部：["eval", "Function", "constructor"]。',
      ),
  },
  handler: async (request, response, context) => {
    const targets: readonly BypassTarget[] =
      request.params.targets ?? DEFAULT_BYPASS_TARGETS;

    await runHook(response, BYPASS_DEBUGGER_TOOLTYPE, async () => {
      const frame = (context as Context).getSelectedFrame();
      await frame.evaluate(buildBypassDebuggerScript(targets));
      return `Bypass Debugger 已安装，Hook 目标：${targets.join(', ')}`;
    });
  },
});
