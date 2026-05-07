/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import type {CollectCodeOptions} from '../../types/index.js';
import type {
  CollectCodeData,
  CollectCodeParams,
  FileSummaryEntry,
} from './types.js';
import {getRuntime} from '../../runtime.js';

/**
 * 从页面收集 JavaScript 代码（标准 MCP 工具版本）。
 *
 * 使用 defineTool 包裹，符合项目工具定义规范，
 * 通过 response 对象返回结构化结果。
 *
 * @example
 * ```typescript
 * // 收集所有脚本
 * // 调用方式：通过 MCP 工具调用，参数为 { url: 'https://example.com', returnMode: 'full' }
 *
 * // 只获取摘要
 * // 调用方式：{ url: 'https://example.com', returnMode: 'summary' }
 *
 * // 按正则筛选
 * // 调用方式：{ url: 'https://example.com', returnMode: 'pattern', pattern: '.*app.*\.js', limit: 10 }
 * ```
 */
export const collectCode = defineTool({
  name: 'collect_code',
  description: 'Collect JavaScript code from a page with smart modes (summary/priority/incremental/full).',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    url: zod.string().url(),
    smartMode: zod.enum(['summary', 'priority', 'incremental', 'full']).optional(),
    returnMode: zod.enum(['full', 'summary', 'pattern', 'top-priority']).optional(),
    includeInline: zod.boolean().optional(),
    includeExternal: zod.boolean().optional(),
    includeDynamic: zod.boolean().optional(),
    maxTotalSize: zod.number().int().positive().optional(),
    maxFileSize: zod.number().int().positive().optional(),
    pattern: zod.string().optional(),
    limit: zod.number().int().positive().optional(),
    topN: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const params = request.params as CollectCodeParams;
    const returnMode = params.returnMode ?? 'full';
    const runtime = getRuntime();
    const shouldCollect =
      returnMode !== 'summary' ||
      runtime.collector.getCollectedFilesSummary().length === 0;

    try {
      // 执行收集
      if (shouldCollect) {
        await runtime.collector.collect(params as CollectCodeOptions);
      }

      let data: CollectCodeData;
      let message: string;

      if (returnMode === 'summary') {
        const summary = runtime.collector.getCollectedFilesSummary() as FileSummaryEntry[];
        data = {
          summary,
          count: summary.length,
          returnMode,
        };
        message = `代码摘要收集完成，共 ${summary.length} 个文件`;
      } else if (returnMode === 'pattern') {
        const patternResult = runtime.collector.getFilesByPattern(
          params.pattern ?? '.*',
          params.limit,
          params.maxTotalSize,
        );
        data = {
          files: patternResult.files.map(file => ({
            url: file.url,
            content: file.content,
            size: file.size,
            type: file.type,
          })),
          totalSize: patternResult.totalSize,
          count: patternResult.returned,
          truncated: patternResult.truncated,
          returnMode,
        };
        message = `模式匹配完成：${patternResult.matched} 个匹配，返回 ${patternResult.returned} 个`;
      } else if (returnMode === 'top-priority') {
        const priorityFiles = runtime.collector.getTopPriorityFiles(
          params.topN,
          params.maxTotalSize,
        );
        data = {
          files: priorityFiles.files.map(file => ({
            url: file.url,
            content: file.content,
            size: file.size,
            type: file.type,
          })),
          totalSize: priorityFiles.totalSize,
          count: priorityFiles.files.length,
          returnMode,
        };
        message = `高优先级文件收集完成，共 ${priorityFiles.files.length} 个`;
      } else {
        // full mode
        const fullResult = await runtime.collector.collect(params);
        data = {
          files: fullResult.files.map(file => ({
            url: file.url,
            content: file.content,
            size: file.size,
            type: file.type,
          })),
          totalSize: fullResult.totalSize,
          count: fullResult.files.length,
          truncated: fullResult.files.length >= (params.maxFileSize ?? Infinity),
          returnMode,
        };
        message = `代码全量收集完成，共 ${fullResult.files.length} 个文件，总大小 ${(fullResult.totalSize / 1024).toFixed(2)} KB`;
      }

      const result = {
        success: true,
        message,
        tooltype: 'collect_code',
        logFormat: 'json',
        data,
      };

      // response.appendResponseLine('```json');
      // response.appendResponseLine(JSON.stringify(result, null, 2));
      // response.appendResponseLine('```');
      response.setStructuredContent(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[collectCode] 收集失败:', errorMsg);

      const errorResult = {
        success: false,
        message: `代码收集失败：${errorMsg}`,
        tooltype: 'collect_code',
        logFormat: 'json',
        data: null,
      };

      // response.appendResponseLine('```json');
      // response.appendResponseLine(JSON.stringify(errorResult, null, 2));
      // response.appendResponseLine('```');
      response.setStructuredContent(errorResult);
    }
  },
});
