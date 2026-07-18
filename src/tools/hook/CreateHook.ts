/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {errorMessage} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 创建 Hook 定义：在进程内生成 hook 脚本和元数据，不注入浏览器。
 *
 * 返回 hookId 和 script，后续通过 inject_hook 注入页面。
 * 参考 old-source/src/tools/hook.ts 的 createHook。
 */
export const createHook = defineTool({
  name: 'create_hook',
  description:
    '推荐：为 function/fetch/xhr/property/cookie/websocket/eval/timer 创建 hook 脚本。Hook 运行时不会暂停页面执行，相比断点是更优的监控与拦截手段。返回 hookId 与 script，供 inject_hook 使用。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    type: zod
      .string()
      .describe(
        'Hook 类型（如 "fetch"、"xhr"、"cookie"、"websocket"、"localStorage"、"console"、"timer"、"eval"、"cryptojs"、"jsencrypt"、"smcrypto"）',
      ),
    params: zod
      .record(zod.string(), zod.unknown())
      .optional()
      .describe('类型相关参数'),
    description: zod
      .string()
      .optional()
      .describe('该 Hook 的可读描述'),
    action: zod
      .enum(['log', 'block', 'modify', 'passthrough'])
      .optional()
      .describe('Hook 动作模式（默认：log）'),
    hookId: zod.string().optional().describe('自定义 Hook 标识符'),
    capture: zod
      .object({
        args: zod.boolean().optional(),
        returnValue: zod.boolean().optional(),
        stack: zod.union([zod.boolean(), zod.number()]).optional(),
        timing: zod.boolean().optional(),
        thisContext: zod.boolean().optional(),
      })
      .optional()
      .describe('采集配置'),
    condition: zod
      .object({
        expression: zod.string().optional(),
        maxCalls: zod.number().int().positive().optional(),
        minInterval: zod.number().int().positive().optional(),
        urlPattern: zod.string().optional(),
      })
      .optional()
      .describe('条件执行'),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    try {
      const result = runtime.hookManager.create(request.params as any);
      response.setStructuredContent({
        success: true,
        message: result.hookId
          ? `Hook created: ${result.hookId}`
          : 'Hook created',
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
