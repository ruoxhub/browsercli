/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile, writeFile} from 'node:fs/promises';

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const wasmDecompile = defineTool({
  name: 'wasm_decompile',
  description: '反编译 .wasm 文件，提供函数级摘要与可疑模式检测。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    inputPath: zod.string().describe('要反编译的 .wasm 文件路径'),
    outputPath: zod.string().optional().describe('.wat 文件的可选输出路径'),
    foldExprs: zod.boolean().optional().describe('折叠表达式块以提升可读性'),
    inlineExport: zod.boolean().optional().describe('将导出名内联到函数体中'),
    maxWatChars: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('WAT 输出超过该字符数后截断'),
  },
  handler: async (request, response) => {
    const {inputPath, outputPath, foldExprs, inlineExport, maxWatChars} =
      request.params;

    try {
      const bytes = Uint8Array.from(await readFile(inputPath));
      const runtime = getRuntime();

      const decompiled = await runtime.wasmDecompiler.decompile(bytes, {
        foldExprs,
        inlineExport,
      });

      if (outputPath) {
        await writeFile(outputPath, decompiled.wat, 'utf-8');
      }

      // Optionally truncate WAT for large outputs
      const wat =
        typeof maxWatChars === 'number' &&
        maxWatChars > 0 &&
        decompiled.wat.length > maxWatChars
          ? `${decompiled.wat.slice(0, maxWatChars)}\n;; ... truncated ...`
          : decompiled.wat;

      response.setStructuredContent({
        success: true,
        message: `反编译完成：${decompiled.functionCount} 个函数，${decompiled.exportCount} 个导出`,
        tooltype: 'wasm_decompile',
        logFormat: 'json',
        data: {
          inputPath,
          outputPath,
          decompiled: {
            ...decompiled,
            wat,
          },
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `WASM 反编译失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'wasm_decompile'},
      );
    }
  },
});
