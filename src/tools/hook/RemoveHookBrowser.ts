/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {errorMessage} from '../shared/pageResponse.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {HOOK_STORE_KEY} from './store-utils.js';

/**
 * 清理浏览器端的 Hook 数据。
 *
 * 删除页面 window.__hookStore 中指定 Hook 的采集数据。
 * 注意：此操作不恢复被 monkey-patch 的原生方法，
 * 因为恢复可能导致页面状态不一致。
 */
export const removeHookBrowser = defineTool({
  name: 'remove_hook_browser',
  description:
    '清理浏览器端的 hook 数据。注意：此操作不会恢复被 monkey-patch 的原生方法。',
  annotations: {
    title: 'Remove Hook',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod.string().describe('要移除的 Hook ID'),
  },
  handler: async (request, response, context) => {
    const {hookId} = request.params;
    const frame = (context as Context).getSelectedFrame();

    if (!hookId) {
      response.setStructuredContent({
        success: false,
        message: 'hookId 参数不能为空',
        tooltype: 'remove_hook_browser',
        data: {hookId: ''},
      });
      return;
    }

    const serializedHookId = JSON.stringify(hookId);
    const cleanupScript = `(function(){
  var s = window[${JSON.stringify(HOOK_STORE_KEY)}];
  var hookId = ${serializedHookId};
  if (s && s[hookId]) {
    delete s[hookId];
  }
})()`;

    try {
      await frame.evaluate(cleanupScript);
      response.setStructuredContent({
        success: true,
        message: `浏览器端 Hook 数据已清理：${hookId}`,
        tooltype: 'remove_hook_browser',
        data: {hookId},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `清理失败（页面可能已关闭）：${errorMessage(error)}`,
        tooltype: 'remove_hook_browser',
        data: {hookId},
      });
    }
  },
});
