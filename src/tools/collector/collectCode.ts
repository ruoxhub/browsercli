/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CollectCodeParams,
  CollectCodeResult,
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
 */
export async function collectCode(
  params: CollectCodeParams,
): Promise<CollectCodeResult> {
  const returnMode = params.returnMode ?? 'full';
  const shouldCollect =
    returnMode !== 'summary' ||
    getRuntime().collector.getCollectedFilesSummary().length === 0;

  try {
    if (shouldCollect) {
      await getRuntime().collector.collect(params as Parameters<typeof getRuntime().collector.collect>[0]);
    }

    let data: unknown;

    if (returnMode === 'summary') {
      data = getRuntime().collector.getCollectedFilesSummary();
    } else if (returnMode === 'pattern') {
      data = getRuntime().collector.getFilesByPattern(
        params.pattern ?? '.*',
        params.limit,
        params.maxTotalSize,
      );
    } else if (returnMode === 'top-priority') {
      data = getRuntime().collector.getTopPriorityFiles(
        params.topN,
        params.maxTotalSize,
      );
    } else {
      data = await getRuntime().collector.collect(params as Parameters<typeof getRuntime().collector.collect>[0]);
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
