/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile, writeFile} from 'node:fs/promises';

import {getRuntime} from '../../runtime.js';

import type {
  WasmDecompileParams,
  WasmDecompileResult_,
} from './types.js';

export async function wasmDecompile(
  params: WasmDecompileParams,
): Promise<WasmDecompileResult_> {
  const tooltype = 'wasm_decompile';

  try {
    const bytes = Uint8Array.from(await readFile(params.inputPath));
    const runtime = getRuntime();

    const decompiled = await runtime.wasmDecompiler.decompile(bytes);

    if (params.outputPath) {
      await writeFile(params.outputPath, decompiled.wat, 'utf-8');
    }

    return {
      success: true,
      message: `反编译完成：${decompiled.functionCount} 个函数，${decompiled.exportCount} 个导出`,
      tooltype,
      logFormat: 'json',
      data: {
        inputPath: params.inputPath,
        outputPath: params.outputPath,
        decompiled,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `WASM 反编译失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
