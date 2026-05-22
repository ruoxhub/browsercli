/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';



export const wasmVmpTrace = defineTool({
  name: 'wasm_vmp_trace',
  description: 'Trace Wasm runtime events captured by the JS-Wasm boundary hooks, with optional module filter.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    maxEvents: zod.number().int().positive().optional().describe('Maximum number of events to return (default 5000)'),
    filterModule: zod.string().optional().describe('Filter events to a specific module ID'),
  },
  handler: async (request, response) => {
    const {maxEvents = 5000, filterModule} = request.params;

    try {
      const runtime = getRuntime();
      const allEvents = runtime.wasmCollector.getRuntimeEvents();
      const modules = runtime.wasmCollector.getModules();

      const filtered = allEvents
        .filter((event) => {
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
          modules: modules.map((m) => ({id: m.id, hash: m.hash, size: m.size})),
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `获取 VMP trace 失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_vmp_trace',
      });
    }
  },
});
