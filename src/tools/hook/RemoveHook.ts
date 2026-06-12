/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {HOOK_STORE_KEY} from './store-utils.js';

/**
 * 移除 Hook：从进程内 HookManager 删除 hook 元数据和记录，
 * 并可选地清理浏览器端 __hookStore 中的数据。
 *
 * 参考 old-source/src/tools/hook.ts 的 removeHook。
 */
export const removeHook = defineTool({
  name: 'remove_hook',
  description:
    'Remove a hook by id. Removes from in-process HookManager and optionally cleans browser-side data.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod.string().describe('Hook ID to remove'),
    cleanBrowser: zod
      .boolean()
      .optional()
      .default(true)
      .describe('Also clean browser-side hook data (default: true)'),
  },
  handler: async (request, response, context) => {
    const {hookId, cleanBrowser = true} = request.params;
    const runtime = getRuntime();

    if (!hookId) {
      response.setStructuredContent({
        success: false,
        message: 'hookId 参数不能为空',
        tooltype: 'remove_hook',
        data: {hookId: ''},
      });
      return;
    }

    const removed = runtime.hookManager.remove(hookId);

    let browserCleaned = false;
    if (cleanBrowser) {
      try {
        const frame = (context as Context).getSelectedFrame();
        const serializedHookId = JSON.stringify(hookId);
        // 使用 Promise.race 添加超时保护，防止调试器暂停时 evaluate 无限挂起
        const cleanupPromise = frame.evaluate(`
          (function(){
            var s = window.${HOOK_STORE_KEY};
            var hookId = ${serializedHookId};
            if (s && s[hookId]) { delete s[hookId]; }
          })()
        `);
        await Promise.race([
          cleanupPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('浏览器端清理超时')), 5000),
          ),
        ]);
        browserCleaned = true;
      } catch {
        // 页面可能已关闭、调试器暂停或不可用，忽略浏览器端清理错误
      }
    }

    if (browserCleaned) {
      response.setStructuredContent({
        success: true,
        message: `浏览器端 Hook 数据已清理：${hookId}`,
        tooltype: 'remove_hook',
        hookId,
      });
      return;
    }

    response.setStructuredContent({
      success: removed,
      message: removed ? `Hook 已移除：${hookId}` : `Hook 未找到：${hookId}`,
      tooltype: 'remove_hook',
      data: {
        hookId,
        browserCleaned,
      },
    });
  },
});
