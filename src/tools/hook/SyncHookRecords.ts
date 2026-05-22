/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {summarizeHookStore, readHookStore} from './store-utils.js';

/**
 * 将 Hook 记录从浏览器端同步到 Node.js 端。
 */
export const syncHookRecords = defineTool({
  name: 'list_created_hooks',
  description:
    'Sync hook records from the browser and list all created hooks with their status.',
  annotations: {
    title: 'List Created Hooks',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('Specific hook ID to sync, omit for all'),
    verbose: zod
      .boolean()
      .optional()
      .describe('Include detailed records per hook, default false'),
    type: zod.string().optional().describe('Filter by hook type'),
    event: zod.string().optional().describe('Filter by event name'),
    phase: zod.string().optional().describe('Filter by phase'),
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
          tooltype: 'list_created_hooks',
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
        tooltype: 'list_created_hooks',
        data: {
          syncedHookIds: summary.hooks.map(item => item.hookId),
          totalRecords: summary.totalRecords,
          hooks,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `同步失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_created_hooks',
        data: {
          syncedHookIds: [] as string[],
          totalRecords: 0,
          hooks: [] as unknown[],
        },
      });
    }
  },
});