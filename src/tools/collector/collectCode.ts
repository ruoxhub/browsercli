/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CollectCodeParams,
  CollectCodeResult,
  CollectorRuntimeServices,
} from './types.js';

/**
 * 从页面收集 JavaScript 代码（纯函数版本）。
 *
 * 不依赖 MCP Tool 框架，接收 runtime 服务注入，
 * 内部调用 collector 做收集，返回结构化对象。
 *
 * @param runtime - Collector 运行时服务
 * @param params - 收集参数
 * @returns 结构化结果 { success, message, tooltype, data }
 */
export async function collectCode(
  runtime: CollectorRuntimeServices,
  params: CollectCodeParams,
): Promise<CollectCodeResult> {
  const returnMode = params.returnMode ?? 'full';
  const shouldCollect =
    returnMode !== 'summary' ||
    runtime.collector.getCollectedFilesSummary().length === 0;

  try {
    if (shouldCollect) {
      await runtime.collector.collect(params as Parameters<typeof runtime.collector.collect>[0]);
    }

    let data: unknown;

    if (returnMode === 'summary') {
      data = runtime.collector.getCollectedFilesSummary();
    } else if (returnMode === 'pattern') {
      data = runtime.collector.getFilesByPattern(
        params.pattern ?? '.*',
        params.limit,
        params.maxTotalSize,
      );
    } else if (returnMode === 'top-priority') {
      data = runtime.collector.getTopPriorityFiles(
        params.topN,
        params.maxTotalSize,
      );
    } else {
      data = await runtime.collector.collect(params as Parameters<typeof runtime.collector.collect>[0]);
    }

    return {
      success: true,
      message: `代码收集完成，返回模式：${returnMode}`,
      tooltype: 'collect_code',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `代码收集失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'collect_code',
      logFormat: 'json',
      data: null,
    };
  }
}
