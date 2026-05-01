/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SearchInScriptsData,
  SearchInScriptsParams,
  SearchInScriptsResult,
} from './types.js';
import {getRuntime} from '../../runtime.js';

/**
 * 在已收集的脚本缓存中搜索匹配正则的代码（纯函数版本）。
 *
 * @param params - 搜索参数
 * @returns 结构化结果 { success, message, tooltype, data }
 */
export function searchInScripts(
  params: SearchInScriptsParams,
): SearchInScriptsResult {
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

    return {
      success: true,
      message: `搜索完成：匹配 ${data.matched} 个文件，返回 ${data.returned} 个`,
      tooltype: 'search_in_scripts',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `搜索失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'search_in_scripts',
      logFormat: 'json',
      data: {
        files: [],
        totalSize: 0,
        matched: 0,
        returned: 0,
        truncated: false,
      },
    };
  }
}
