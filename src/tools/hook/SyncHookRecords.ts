/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {errorMessage} from '../shared/pageResponse.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {summarizeHookStore, readHookStore} from './store-utils.js';

/**
 * 将 Hook 记录从浏览器端同步到 Node.js 端。
 */
export const syncHookRecords = defineTool({
  name: 'sync_hook_records',
  description:
    '从浏览器同步 hook 记录，并列出所有已创建 hook 及其状态。',
  annotations: {
    title: 'List Created Hooks',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('指定要同步的 Hook ID，省略则同步全部'),
    verbose: zod
      .boolean()
      .optional()
      .describe('包含每个 Hook 的详细记录，默认 false'),
    type: zod.string().optional().describe('按 Hook 类型过滤'),
    event: zod.string().optional().describe('按事件名过滤'),
    phase: zod.string().optional().describe('按阶段过滤'),
  },
  handler: async (request, response, context) => {
    const {hookId, verbose, type, event, phase} = request.params;
    const frame = (context as Context).getSelectedFrame();

    try {
      const storeSnapshot = await readHookStore(frame, hookId);

      if (!storeSnapshot || typeof storeSnapshot !== 'object') {
        response.setStructuredContent({
          success: true,
          message: '浏览器端无 Hook 数据',
          tooltype: 'sync_hook_records',
          data: {
            syncedHookIds: [] as string[],
            totalRecords: 0,
            hooks: [] as unknown[],
          },
        });
        return;
      }

      const summary = summarizeHookStore(storeSnapshot, {
        type,
        event,
        phase,
        preserveEmpty: Boolean(hookId) || (!type && !event && !phase),
      });
      const hooks = verbose
        ? summary.hooks
        : summary.hooks.map(({hookId: id, total, type}) => ({
            hookId: id,
            total,
            type,
          }));

      response.setStructuredContent({
        success: true,
        message: `同步完成，${summary.totalHooks} 个 Hook，共 ${summary.totalRecords} 条记录`,
        tooltype: 'sync_hook_records',
        data: {
          syncedHookIds: summary.hooks.map(item => item.hookId),
          totalRecords: summary.totalRecords,
          hooks,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `同步失败：${errorMessage(error)}`,
        tooltype: 'sync_hook_records',
        data: {
          syncedHookIds: [] as string[],
          totalRecords: 0,
          hooks: [] as unknown[],
        },
      });
    }
  },
});
