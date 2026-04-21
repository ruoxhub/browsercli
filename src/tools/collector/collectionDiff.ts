/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CollectionDiffData,
  CollectionDiffParams,
  CollectionDiffResult,
  CollectorRuntimeServices,
  DiffChangedEntry,
  FileSummaryEntry,
} from './types.js';

/**
 * 对比两次收集的文件摘要差异（纯函数版本）。
 *
 * @param runtime - Collector 运行时服务（用于获取当前摘要）
 * @param params - Diff 参数
 * @returns 结构化结果 { success, message, tooltype, data }
 */
export function collectionDiff(
  runtime: CollectorRuntimeServices,
  params: CollectionDiffParams,
): CollectionDiffResult {
  try {
    const current: FileSummaryEntry[] =
      (params.current ?? runtime.collector.getCollectedFilesSummary()) as FileSummaryEntry[];
    const previous: FileSummaryEntry[] = (params.previous ?? []) as FileSummaryEntry[];

    const diff = diffSummaries(previous, current, params.includeUnchanged);

    const data: CollectionDiffData = {
      previousCount: previous.length,
      currentCount: current.length,
      addedCount: diff.added.length,
      removedCount: diff.removed.length,
      changedCount: diff.changed.length,
      ...diff,
    };

    return {
      success: true,
      message: `对比完成：${data.addedCount} 新增, ${data.removedCount} 移除, ${data.changedCount} 变更`,
      tooltype: 'collection_diff',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `对比失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'collection_diff',
      logFormat: 'json',
      data: {
        previousCount: 0,
        currentCount: 0,
        addedCount: 0,
        removedCount: 0,
        changedCount: 0,
        added: [],
        removed: [],
        changed: [],
      },
    };
  }
}

function diffSummaries(
  previous: FileSummaryEntry[],
  current: FileSummaryEntry[],
  includeUnchanged = false,
): {
  added: FileSummaryEntry[];
  removed: FileSummaryEntry[];
  changed: DiffChangedEntry[];
  unchanged?: FileSummaryEntry[];
} {
  const prevMap = new Map(previous.map(item => [item.url, item]));
  const currentMap = new Map(current.map(item => [item.url, item]));

  const added: FileSummaryEntry[] = [];
  const removed: FileSummaryEntry[] = [];
  const changed: DiffChangedEntry[] = [];
  const unchanged: FileSummaryEntry[] = [];

  for (const item of current) {
    const prev = prevMap.get(item.url);
    if (!prev) {
      added.push(item);
      continue;
    }
    if (prev.size !== item.size) {
      changed.push({
        url: item.url,
        type: item.type,
        previousSize: prev.size,
        currentSize: item.size,
        delta: item.size - prev.size,
      });
      continue;
    }
    if (includeUnchanged) {
      unchanged.push(item);
    }
  }

  for (const item of previous) {
    if (!currentMap.has(item.url)) {
      removed.push(item);
    }
  }

  return includeUnchanged
    ? {added, removed, changed, unchanged}
    : {added, removed, changed};
}
