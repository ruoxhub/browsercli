/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile} from 'node:fs/promises';

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';


export const wasmInspectSections = defineTool({
  name: 'wasm_inspect_sections',
  description: 'Inspect Wasm binary sections: section map, function signatures, string scan, and import/export summary.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    inputPath: zod.string().describe('Path to the .wasm file to inspect'),
    sections: zod.enum(['headers', 'details', 'disassemble', 'all']).optional().describe('Level of section detail (default "details")'),
    includeFunctionSignatures: zod.boolean().optional().describe('Include function signatures in output'),
    includeStringScan: zod.boolean().optional().describe('Scan for embedded strings'),
    maskSensitiveStrings: zod.boolean().optional().describe('Mask potentially sensitive strings'),
    maxStringSlots: zod.number().int().positive().optional().describe('Max string slots to return'),
    maxSummaryLines: zod.number().int().positive().optional().describe('Max summary lines per section'),
  },
  handler: async (request, response) => {
    const {
      inputPath,
      sections = 'details',
      includeFunctionSignatures = true,
      includeStringScan = true,
      maskSensitiveStrings = false,
      maxStringSlots,
      maxSummaryLines,
    } = request.params;

    try {
      const bytes = Uint8Array.from(await readFile(inputPath));
      const runtime = getRuntime();

      const analysis = runtime.wasmAnalyzer.analyzeBinary(bytes, {
        includeFunctionSignatures,
        includeRawSectionMap: sections === 'all' || sections === 'disassemble',
        includeStringScan,
        maskSensitiveStrings,
        maxStringSlots,
        maxSummaryLines,
      });

      response.setStructuredContent({
        success: true,
        message: `分析完成：${analysis.sections.length} 个 section，${analysis.functionCount} 个函数，${analysis.importFunctionCount} 个导入，${analysis.exportFunctionCount} 个导出`,
        tooltype: 'wasm_inspect_sections',
        logFormat: 'json',
        data: {
          inputPath,
          analysis,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `WASM section 检查失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'wasm_inspect_sections',
      });
    }
  },
});
