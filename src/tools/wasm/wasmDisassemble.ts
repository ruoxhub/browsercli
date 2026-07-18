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
  description:
    '使用内置反编译器将 .wasm 文件反汇编为 WAT（WebAssembly 文本格式）。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    inputPath: zod.string().describe('要反汇编的 .wasm 文件路径'),
    outputPath: zod
      .string()
      .optional()
      .describe('.wat 文件的可选输出路径'),
    foldExprs: zod
      .boolean()
      .optional()
      .describe('折叠表达式块以提升可读性（默认 true）'),
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
