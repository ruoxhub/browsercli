/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {getDebuggerFromContext} from '../debugger/runtime-helpers.js';
import {defineTool} from '../ToolDefinition.js';

import type {DeobfuscateCodeResult} from './types.js';
export const deobfuscateCode = defineTool({
  name: 'deobfuscate_code',
  description: 'AI-assisted JavaScript deobfuscation.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string().optional().describe('要反混淆的 JavaScript 源码'),
    scriptId: zod
      .string()
      .optional()
      .describe('调试会话中的脚本 ID（用于直接获取对应脚本源码反混淆）'),
    aggressive: zod.boolean().optional(),
    renameVariables: zod.boolean().optional(),
  },
  handler: async (request, response, context) => {
    try {
      const {code, scriptId} = request.params;
      let targetCode = code;

      if (scriptId) {
        const debuggerContext = await getDebuggerFromContext(context);
        targetCode = await debuggerContext.getScriptSource(scriptId);
        if (targetCode === null || targetCode === undefined) {
          throw new Error(`未找到脚本 ID 为 ${scriptId} 的源码`);
        }
      } else if (targetCode === undefined || targetCode === null) {
        throw new Error('必须提供 code 或 scriptId 参数之一');
      }

      const result = await getRuntime().deobfuscator.deobfuscate({
        ...request.params,
        code: targetCode,
      } as any);
      response.setStructuredContent<DeobfuscateCodeResult>({
        success: true,
        message: 'Deobfuscation completed',
        tooltype: 'deobfuscate',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent<DeobfuscateCodeResult>({
        success: false,
        message: `Deobfuscation failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'deobfuscate',
        data: {} as DeobfuscateCodeResult['data'],
      });
    }
  },
});
