/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {errorMessage} from '../shared/pageResponse.js';

/**
 * 创建 Hook 定义：在进程内生成 hook 脚本和元数据，不注入浏览器。
 *
 * 返回 hookId 和 script，后续通过 inject_hook 注入页面。
 * 参考 old-source/src/tools/hook.ts 的 createHook。
 */
export const createHook = defineTool({
  name: 'create_hook',
  description:
    'RECOMMENDED: Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer. Hooks run without pausing page execution and are the preferred approach over breakpoints for monitoring and interception. Returns hookId and script for use with inject_hook.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    type: zod.string().describe(
      'Hook type (e.g., "fetch", "xhr", "cookie", "websocket", "localStorage", "console", "timer", "eval", "cryptojs", "jsencrypt", "smcrypto")',
    ),
    params: zod.record(zod.string(), zod.unknown()).optional().describe('Type-specific parameters'),
    description: zod.string().optional().describe('Human-readable description of this hook'),
    action: zod.enum(['log', 'block', 'modify', 'passthrough']).optional().describe('Hook action mode (default: log)'),
    hookId: zod.string().optional().describe('Custom hook identifier'),
    capture: zod.object({
      args: zod.boolean().optional(),
      returnValue: zod.boolean().optional(),
      stack: zod.union([zod.boolean(), zod.number()]).optional(),
      timing: zod.boolean().optional(),
      thisContext: zod.boolean().optional(),
    }).optional().describe('Capture configuration'),
    condition: zod.object({
      expression: zod.string().optional(),
      maxCalls: zod.number().int().positive().optional(),
      minInterval: zod.number().int().positive().optional(),
      urlPattern: zod.string().optional(),
    }).optional().describe('Conditional execution'),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    try {
      const result = runtime.hookManager.create(request.params as any);
      response.setStructuredContent({
        success: true,
        message: result.hookId ? `Hook created: ${result.hookId}` : 'Hook created',
        tooltype: 'create_hook',
        data: result,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: errorMessage(error),
        tooltype: 'create_hook',
        data: {
          hookId: null,
          script: null,
          error: errorMessage(error),
        },
      });
    }
  },
});