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
  CollectionDiffParams,
  CollectionDiffData,
  DiffChangedEntry,
  FileSummaryEntry,
} from './types.js';

/**
 * 对比两次收集的文件摘要差异（标准 MCP 工具版本）。
 *
 * 使用 defineTool 包裹，符合项目工具定义规范，
 * 通过 response 对象返回结构化结果。
 */
export const collectionDiff = defineTool({
  name: 'collection_diff',
  description: '对比上一次与当前收集到的文件摘要。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    previous: zod
      .array(
        zod.object({
          url: zod.string(),
          size: zod.number().int().nonnegative(),
          type: zod.string(),
        }),
      )
      .optional()
      .default([]),
    current: zod
      .array(
        zod.object({
          url: zod.string(),
          size: zod.number().int().nonnegative(),
          type: zod.string(),
        }),
      )
      .optional(),
    includeUnchanged: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const params = request.params as CollectionDiffParams;
    const runtime = getRuntime();

    try {
      const current: FileSummaryEntry[] = (params.current ??
        runtime.collector.getCollectedFilesSummary()) as FileSummaryEntry[];
      const previous: FileSummaryEntry[] = (params.previous ??
        []) as FileSummaryEntry[];

      const diff = diffSummaries(previous, current, params.includeUnchanged);

      const data: CollectionDiffData = {
        previousCount: previous.length,
        currentCount: current.length,
        addedCount: diff.added.length,
        removedCount: diff.removed.length,
        changedCount: diff.changed.length,
        ...diff,
      };

      const result = {
        success: true,
        message: `对比完成：${data.addedCount} 新增, ${data.removedCount} 移除, ${data.changedCount} 变更`,
        tooltype: 'collection_diff',
        data: data,
      };
      response.setStructuredContent(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[collectionDiff] 对比失败:', errorMsg);

      const errorResult = {
        success: false,
        message: `对比失败：${errorMsg}`,
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
      response.setStructuredContent(errorResult);
    }
  },
});

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
