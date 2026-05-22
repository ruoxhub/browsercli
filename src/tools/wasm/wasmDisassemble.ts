/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile, writeFile} from 'node:fs/promises';

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';


export const wasmDisassemble = defineTool({
  name: 'wasm_disassemble',
  description: 'Disassemble a .wasm file to WAT (WebAssembly Text Format) using the built-in decompiler.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    inputPath: zod.string().describe('Path to the .wasm file to disassemble'),
    outputPath: zod.string().optional().describe('Optional output path for the .wat file'),
    foldExprs: zod.boolean().optional().describe('Fold expression blocks for readability (default true)'),
  },
  handler: async (request, response) => {
    const {inputPath, outputPath, foldExprs = true} = request.params;

    try {
      const bytes = Uint8Array.from(await readFile(inputPath));
      const runtime = getRuntime();

      const decompiled = await runtime.wasmDecompiler.decompile(bytes, {
        foldExprs,
      });

      if (outputPath) {
        await writeFile(outputPath, decompiled.wat, 'utf-8');
      }

      response.setStructuredContent({
        success: true,
        message: `反汇编完成：${decompiled.functionCount} 个函数，${decompiled.lineCount} 行 WAT`,
        tooltype: 'wasm_disassemble',
        logFormat: 'json',
        data: {
          inputPath,
          outputPath,
          decompiled,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `WASM 反汇编失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_disassemble',
      });
    }
  },
});
