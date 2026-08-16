/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {runNativeCommand} from './nativeCommand.js';
import type {NativeToolInfo, WasmCapabilitiesData} from './types.js';

async function probeNativeTool(
  name: string,
  flag: string,
): Promise<NativeToolInfo> {
  const result = await runNativeCommand(name, [flag], 5000);
  if (result.exitCode !== 0) {
    return {name, available: false};
  }
  const version = (result.stdout || result.stderr)
    .trim()
    .split('\n')[0]
    ?.slice(0, 120);
  return {name, available: true, version};
}

export const wasmCapabilities = defineTool({
  name: 'wasm_capabilities',
  description:
    '检测可用的原生 Wasm 工具链（wabt、binaryen、wasmtime、wasmer）与会话状态。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    try {
      const [wabt, binaryen, wasmtime, wasmer] = await Promise.all([
        probeNativeTool('wasm2wat', '--version'),
        probeNativeTool('wasm-opt', '--version'),
        probeNativeTool('wasmtime', '--version'),
        probeNativeTool('wasmer', '--version'),
      ]);

      const runtime = getRuntime();
      const modules = runtime.wasmCollector.getModules();
      const events = runtime.wasmCollector.getRuntimeEvents();

      response.setStructuredContent({
        success: true,
        message: `检测完成：${modules.length} 个模块，${events.length} 个运行时事件`,
        tooltype: 'wasm_capabilities',
        logFormat: 'json',
        data: {
          wabt,
          binaryen,
          wasmtime,
          wasmer,
          capturedModules: modules.length,
          runtimeEvents: events.length,
        } satisfies WasmCapabilitiesData,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `检测 WASM 能力失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_capabilities',
      });
    }
  },
});
