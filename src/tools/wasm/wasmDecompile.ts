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

function appendJson(
  response: {appendResponseLine(value: string): void},
  value: unknown,
): void {
  response.appendResponseLine('```json');
  response.appendResponseLine(JSON.stringify(value, null, 2));
  response.appendResponseLine('```');
}

export const wasmDecompile = defineTool({
  name: 'wasm_decompile',
  description: 'Decompile a .wasm file with function-level summaries and suspicious-pattern detection.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    inputPath: zod.string().describe('Path to the .wasm file to decompile'),
    outputPath: zod.string().optional().describe('Optional output path for the .wat file'),
    foldExprs: zod.boolean().optional().describe('Fold expression blocks for readability'),
    inlineExport: zod.boolean().optional().describe('Inline export names into function bodies'),
    maxWatChars: zod.number().int().positive().optional().describe('Truncate WAT output beyond this many characters'),
  },
  handler: async (request, response) => {
    const {inputPath, outputPath, foldExprs, inlineExport, maxWatChars} = request.params;

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
      const wat = typeof maxWatChars === 'number' && maxWatChars > 0 && decompiled.wat.length > maxWatChars
        ? `${decompiled.wat.slice(0, maxWatChars)}\n;; ... truncated ...`
        : decompiled.wat;

      appendJson(response, {
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
      appendJson(response, {
        success: false,
        message: `WASM 反编译失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_decompile',
      });
    }
  },
});
