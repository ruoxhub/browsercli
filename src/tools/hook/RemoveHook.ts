/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {evaluateInPageRuntime} from '../debugger/evaluateInPageRuntime.js';
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
    '按 ID 移除 hook。会从进程内 HookManager 删除，并可选地清理浏览器端数据。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod.string().describe('要移除的 Hook ID'),
    cleanBrowser: zod
      .boolean()
      .optional()
      .default(true)
      .describe('同时清理浏览器端 hook 数据（默认：true）'),
  },
  handler: async (request, response, context) => {
    const {hookId, cleanBrowser = true} = request.params;
    const runtime = getRuntime();

    if (!hookId) {
      throw createToolError(ErrorCodes.VALIDATION, 'hookId 参数不能为空', {
        toolName: 'remove_hook',
      });
    }

    const removed = runtime.hookManager.remove(hookId);

    let browserCleaned = false;
    if (cleanBrowser) {
      try {
        const frame = (context as Context).getSelectedFrame();
        const serializedHookId = JSON.stringify(hookId);
        // 必须走页面默认 world：frame.evaluate 落在 Playwright 隔离 world，
        // 删不到页面自己的 window.__hookStore，却会让本工具谎报已清理。
        // 脚本回传是否真的删到了条目，没删到不能算清理成功。
        const deleted = await evaluateInPageRuntime<boolean>(
          frame,
          `
          (function(){
            var s = window.${HOOK_STORE_KEY};
            var hookId = ${serializedHookId};
            if (s && s[hookId]) { delete s[hookId]; return true; }
            return false;
          })()
        `,
        );
        browserCleaned = deleted === true;
      } catch {
        // 页面可能已关闭、调试器暂停或不可用，忽略浏览器端清理错误
      }
    }

    if (!removed && !browserCleaned) {
      throw createToolError(ErrorCodes.NOT_FOUND, `Hook 未找到：${hookId}`, {
        toolName: 'remove_hook',
        hookId,
      });
    }

    // 管理器里没有、但页面 __hookStore 里清掉了：hook 只存在于页面侧，
    // 这时按浏览器端清理结果报告成功。
    if (!removed) {
      response.setStructuredContent({
        success: true,
        message: `浏览器端 Hook 数据已清理：${hookId}`,
        tooltype: 'remove_hook',
        hookId,
      });
      return;
    }

    response.setStructuredContent({
      success: true,
      message: `Hook 已移除：${hookId}`,
      tooltype: 'remove_hook',
      hookId,
      data: {
        hookId,
        browserCleaned,
      },
    });
  },
});
