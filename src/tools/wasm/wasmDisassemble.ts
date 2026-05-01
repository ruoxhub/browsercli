/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile, writeFile} from 'node:fs/promises';

import {getRuntime} from '../../runtime.js';

import type {
  WasmDisassembleParams,
  WasmDisassembleResult,
} from './types.js';

export async function wasmDisassemble(
  params: WasmDisassembleParams,
): Promise<WasmDisassembleResult> {
  const tooltype = 'wasm_disassemble';

  try {
    const bytes = Uint8Array.from(await readFile(params.inputPath));
    const runtime = getRuntime();

    const decompiled = await runtime.wasmDecompiler.decompile(bytes, {
      foldExprs: params.foldExprs ?? true,
    });

    if (params.outputPath) {
      await writeFile(params.outputPath, decompiled.wat, 'utf-8');
    }

    return {
      success: true,
      message: `反汇编完成：${decompiled.functionCount} 个函数，${decompiled.lineCount} 行 WAT`,
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
      message: `WASM 反汇编失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
