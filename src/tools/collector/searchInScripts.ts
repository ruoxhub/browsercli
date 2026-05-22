/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {
  SearchInScriptsParams,
  SearchInScriptsData,
  SearchInScriptsResult,
} from './types.js';


/**
 * 在已收集的脚本缓存中搜索匹配正则的代码（标准 MCP 工具版本）。
 *
 * 使用 defineTool 包裹，符合项目工具定义规范，
 * 通过 response 对象返回结构化结果。
 */
export const searchInScripts = defineTool({
  name: 'search_in_scripts',
  description: 'Search in collected script cache with regex pattern.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    pattern: zod.string(),
    limit: zod.number().int().positive().optional(),
    maxTotalSize: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const params = request.params as SearchInScriptsParams;

    try {
      const result = getRuntime().collector.getFilesByPattern(
        params.pattern,
        params.limit,
        params.maxTotalSize,
      );

      const data: SearchInScriptsData = {
        files: result.files.map(file => ({
          url: file.url,
          content: file.content,
          size: file.size,
          type: file.type,
        })),
        totalSize: result.totalSize,
        matched: result.matched,
        returned: result.returned,
        truncated: result.truncated,
      };

      const responseData: SearchInScriptsResult = {
        success: true,
        message: `搜索完成：匹配 ${data.matched} 个文件，返回 ${data.returned} 个`,
        tooltype: 'search_in_scripts',
        data: data
      };

      response.setStructuredContent(responseData);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[searchInScripts] 搜索失败:', errorMsg);

      const errorData: SearchInScriptsResult = {
        success: false,
        message: `搜索失败：${errorMsg}`,
        tooltype: 'search_in_scripts',
        data: {
          files: [],
          totalSize: 0,
          matched: 0,
          returned: 0,
          truncated: false,
        },
      };
      response.setStructuredContent(errorData);
    }
  },
});
