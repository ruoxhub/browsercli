/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CollectCodeOptions} from '../../types/index.js';
import type {
  CollectCodeData,
  CollectCodeParams,
  CollectCodeResult,
  FileSummaryEntry,
} from './types.js';
import {getRuntime} from '../../runtime.js';

/**
 * 从页面收集 JavaScript 代码（纯函数版本）。
 *
 * 不依赖 MCP Tool 框架，接收 runtime 服务注入，
 * 内部调用 collector 做收集，返回结构化对象。
 *
 * @param params - 收集参数
 * @returns 结构化结果 { success, message, tooltype, data }
 *
 * @example
 * ```typescript
 * // 收集所有脚本
 * const result = await collectCode({ url: 'https://example.com', returnMode: 'full' });
 *
 * // 只获取摘要
 * const summary = await collectCode({ url: 'https://example.com', returnMode: 'summary' });
 *
 * // 按正则筛选
 * const filtered = await collectCode({
 *   url: 'https://example.com',
 *   returnMode: 'pattern',
 *   pattern: '.*app.*\\.js',
 *   limit: 10,
 * });
 * ```
 */
export async function collectCode(
  params: CollectCodeParams,
): Promise<CollectCodeResult> {
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
      const fullResult = await runtime.collector.collect(params as CollectCodeOptions);
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

    return {
      success: true,
      message,
      tooltype: 'collect_code',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[collectCode] 收集失败:', errorMsg);

    return {
      success: false,
      message: `代码收集失败：${errorMsg}`,
      tooltype: 'collect_code',
      logFormat: 'json',
      data: null,
    };
  }
}
