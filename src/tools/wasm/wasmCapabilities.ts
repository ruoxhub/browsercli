/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';

import {getRuntime} from '../../runtime.js';

import type {
  NativeToolInfo,
  WasmCapabilitiesParams,
  WasmCapabilitiesResult,
} from './types.js';

function probeNativeTool(name: string, flag: string): Promise<NativeToolInfo> {
  return new Promise((resolve) => {
    execFile(name, [flag], {timeout: 5000}, (error, stdout) => {
      if (error) {
        resolve({name, available: false});
        return;
      }
      const version = stdout.trim().split('\n')[0]?.slice(0, 120);
      resolve({name, available: true, version});
    });
  });
}

export async function wasmCapabilities(
  _params?: WasmCapabilitiesParams,
): Promise<WasmCapabilitiesResult> {
  const tooltype = 'wasm_capabilities';

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

    return {
      success: true,
      message: `检测完成：${modules.length} 个模块，${events.length} 个运行时事件`,
      tooltype,
      logFormat: 'json',
      data: {
        wabt,
        binaryen,
        wasmtime,
        wasmer,
        capturedModules: modules.length,
        runtimeEvents: events.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `检测 WASM 能力失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
