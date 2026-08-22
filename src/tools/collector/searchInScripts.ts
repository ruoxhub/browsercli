/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
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
  description: '使用正则表达式在已收集的脚本缓存中搜索。',
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

      if (result.error) {
        const isPatternError = result.error === 'INVALID_PATTERN';
        throw createToolError(
          isPatternError ? ErrorCodes.VALIDATION : ErrorCodes.RUNTIME,
          result.message ?? result.error,
          {toolName: 'search_in_scripts', pattern: params.pattern},
        );
      }

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
        message: result.warning
          ? result.warning
          : `搜索完成：匹配 ${data.matched} 个文件，返回 ${data.returned} 个`,
        tooltype: 'search_in_scripts',
        data: data,
        ...(result.warning
          ? {suggestion: '请先调用 collect_code 收集脚本后再搜索。'}
          : {}),
      };

      response.setStructuredContent(responseData);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isPatternError = errorMsg.includes('INVALID_PATTERN');
      throw createToolError(
        isPatternError ? ErrorCodes.VALIDATION : ErrorCodes.RUNTIME,
        `搜索失败：${errorMsg}`,
        {toolName: 'search_in_scripts'},
      );
    }
  },
});
