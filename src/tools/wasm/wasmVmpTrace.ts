/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const wasmVmpTrace = defineTool({
  name: 'wasm_vmp_trace',
  description:
    '追踪由 JS-Wasm 边界 hook 捕获的 Wasm 运行时事件，可选按模块过滤。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    maxEvents: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大事件数（默认 5000）'),
    filterModule: zod.string().optional().describe('按指定模块 ID 过滤事件'),
  },
  handler: async (request, response) => {
    const {maxEvents = 5000, filterModule} = request.params;

    try {
      const runtime = getRuntime();
      const allEvents = runtime.wasmCollector.getRuntimeEvents();
      const modules = runtime.wasmCollector.getModules();

      const filtered = allEvents
        .filter(event => {
          if (filterModule && event.moduleId !== filterModule) {
            return false;
          }
          return true;
        })
        .slice(0, maxEvents);

      response.setStructuredContent({
        success: true,
        message: `捕获到 ${filtered.length} 个运行时事件（共 ${allEvents.length} 个，${modules.length} 个模块）`,
        tooltype: 'wasm_vmp_trace',
        logFormat: 'json',
        data: {
          totalEvents: allEvents.length,
          filteredEvents: filtered.length,
          events: filtered,
          modules: modules.map(m => ({id: m.id, hash: m.hash, size: m.size})),
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取 VMP trace 失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'wasm_vmp_trace'},
      );
    }
  },
});
