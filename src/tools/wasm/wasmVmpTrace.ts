/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';

import type {
  WasmVmpTraceParams,
  WasmVmpTraceResult,
} from './types.js';

export async function wasmVmpTrace(
  params?: WasmVmpTraceParams,
): Promise<WasmVmpTraceResult> {
  const tooltype = 'wasm_vmp_trace';

  try {
    const runtime = getRuntime();
    const maxEvents = params?.maxEvents ?? 5000;
    const filterModule = params?.filterModule;

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

    return {
      success: true,
      message: `捕获到 ${filtered.length} 个运行时事件（共 ${allEvents.length} 个，${modules.length} 个模块）`,
      tooltype,
      logFormat: 'json',
      data: {
        totalEvents: allEvents.length,
        filteredEvents: filtered.length,
        events: filtered,
        modules: modules.map((m) => ({id: m.id, hash: m.hash, size: m.size})),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `获取 VMP trace 失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
