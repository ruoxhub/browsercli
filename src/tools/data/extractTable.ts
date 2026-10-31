/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {zod} from '../../third_party/index.js';
import {
  createToolError,
  ErrorCodes,
  ToolError,
  type ToolErrorCode,
} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {encodeCsv, normalizeTable} from './extractTableModel.js';
import {
  captureTable,
  type TableCaptureFailureReason,
} from './extractTablePage.js';

/** Collector failure reasons that mean the caller asked for the wrong thing. */
const CAPTURE_FAILURE_CODES: Record<TableCaptureFailureReason, ToolErrorCode> =
  {
    not_found: ErrorCodes.NOT_FOUND,
    ambiguous: ErrorCodes.VALIDATION,
    not_a_table: ErrorCodes.VALIDATION,
    hidden: ErrorCodes.VALIDATION,
    bad_selector: ErrorCodes.VALIDATION,
  };

function isCaptureFailureReason(
  value: unknown,
): value is TableCaptureFailureReason {
  // `in` would also accept inherited keys such as "constructor".
  return (
    typeof value === 'string' && Object.hasOwn(CAPTURE_FAILURE_CODES, value)
  );
}

/**
 * 提取当前 Frame 中表格的结构化数据。
 *
 * 支持原生 <table> 与 role=table/grid，归一化为稳定列键（c1..cN）、
 * 数据行与合并单元格 spans；可选导出 CSV 或 JSON 文件。
 */
export const extractTable = defineTool({
  name: 'extract_table',
  description:
    '从当前 Frame 的表格（原生 table 或 ARIA role=table/grid）提取结构化数据：稳定列键（c1..cN）、数据行、合并单元格 spans 与覆盖度。selector 必须是唯一匹配的 CSS 选择器；format=csv 时必须提供 outputPath。',
  annotations: {
    title: '提取表格数据',
    category: ToolCategory.DATA,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .min(1)
      .describe('唯一匹配目标表格的 CSS 选择器（只支持 CSS）。'),
    format: zod
      .enum(['json', 'csv'])
      .optional()
      .default('json')
      .describe('输出格式（默认 json）。csv 必须配合 outputPath 使用。'),
    outputPath: zod
      .string()
      .optional()
      .describe('把提取结果写入该文件路径（父目录不存在时自动创建）。'),
    includeHidden: zod
      .boolean()
      .optional()
      .default(false)
      .describe(
        '是否包含隐藏的行与单元格（默认 false；隐藏容器内的表格始终拒绝）。',
      ),
  },
  handler: async (request, response, context) => {
    const {
      selector,
      format = 'json',
      outputPath,
      includeHidden = false,
    } = request.params;

    if (format === 'csv' && !outputPath) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'format=csv 时必须提供 outputPath：CSV 内容不随响应返回，否则数据会丢失',
        {toolName: 'extract_table', selector},
      );
    }

    const frame = (context as Context).getSelectedFrame();
    if (!frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'extract_table',
      });
    }

    try {
      const raw = await captureTable(frame, {selector, includeHidden});
      const table = normalizeTable(raw);

      if (outputPath) {
        const content =
          format === 'csv' ? encodeCsv(table) : JSON.stringify(table, null, 2);
        await mkdir(path.dirname(outputPath), {recursive: true});
        await writeFile(outputPath, content, 'utf8');
      }

      const data = outputPath ? {...table, outputPath} : table;
      response.setStructuredContent({
        success: true,
        message:
          `已提取 ${table.rows.length} 行 × ${table.columns.length} 列` +
          (outputPath ? `，并写入 ${outputPath}` : ''),
        tooltype: 'extract_table',
        data,
      });
    } catch (error) {
      // A ToolError raised above (or by a future callee) keeps its own code.
      if (error instanceof ToolError) throw error;

      const reason = (error as {reason?: unknown} | null)?.reason;
      const code = isCaptureFailureReason(reason)
        ? CAPTURE_FAILURE_CODES[reason]
        : ErrorCodes.RUNTIME;
      throw createToolError(
        code,
        `提取表格失败：${error instanceof Error ? error.message : String(error)}`,
        {
          toolName: 'extract_table',
          selector,
          ...(isCaptureFailureReason(reason) ? {reason} : {}),
        },
      );
    }
  },
});
