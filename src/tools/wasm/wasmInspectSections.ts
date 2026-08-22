/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFile} from 'node:fs/promises';

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const wasmInspectSections = defineTool({
  name: 'wasm_inspect_sections',
  description:
    '检查 Wasm 二进制节区：节区映射、函数签名、字符串扫描，以及导入/导出摘要。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    inputPath: zod.string().describe('要检查的 .wasm 文件路径'),
    sections: zod
      .enum(['headers', 'details', 'disassemble', 'all'])
      .optional()
      .describe('节区详情级别（默认 "details"）'),
    includeFunctionSignatures: zod
      .boolean()
      .optional()
      .describe('在输出中包含函数签名'),
    includeStringScan: zod.boolean().optional().describe('扫描内嵌字符串'),
    maskSensitiveStrings: zod
      .boolean()
      .optional()
      .describe('对可能敏感的字符串进行脱敏'),
    maxStringSlots: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大字符串槽位数'),
    maxSummaryLines: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('每个节区的最大摘要行数'),
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
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `WASM section 检查失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'wasm_inspect_sections'},
      );
    }
  },
});
