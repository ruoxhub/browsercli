/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CodeCollector} from '../modules/collector/CodeCollector.js';
import {zod} from '../third_party/index.js';
import type {CollectCodeOptions} from '../types/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import type {MessagesResult} from './shared/types.js';
import {
  defineBrowserTool,
  definePageTool,
  defineStatelessTool,
} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

/**
 * Collector 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface CollectorResult extends MessagesResult {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 收集代码的智能模式 */
export type SmartMode = 'summary' | 'priority' | 'incremental' | 'full';

/** 返回模式 */
export type ReturnMode = 'full' | 'summary' | 'pattern' | 'top-priority';

/** 文件类型 */
export type ScriptType =
  | 'inline'
  | 'external'
  | 'dynamic'
  | 'service-worker'
  | 'web-worker';

/** collectCode 参数 */
export interface CollectCodeParams {
  url: string;
  smartMode?: SmartMode;
  returnMode?: ReturnMode;
  includeInline?: boolean;
  includeExternal?: boolean;
  includeDynamic?: boolean;
  maxTotalSize?: number;
  maxFileSize?: number;
  pattern?: string;
  limit?: number;
  topN?: number;
}

/** 文件摘要条目 */
export interface FileSummaryEntry {
  url: string;
  size: number;
  type: string;
  truncated?: boolean;
  originalSize?: number;
}

/** Diff 变更条目 */
export interface DiffChangedEntry {
  url: string;
  type: string;
  previousSize: number;
  currentSize: number;
  delta: number;
}

/** collectionDiff 结果 */
export interface CollectionDiffData {
  previousCount: number;
  currentCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  added: FileSummaryEntry[];
  removed: FileSummaryEntry[];
  changed: DiffChangedEntry[];
  unchanged?: FileSummaryEntry[];
}

/** collectionDiff 参数 */
export interface CollectionDiffParams {
  previous: FileSummaryEntry[];
  current?: FileSummaryEntry[];
  includeUnchanged?: boolean;
}

/** collectCode 返回数据结构 */
export interface CollectCodeData {
  /** 收集的文件列表或摘要 */
  files?: Array<{url: string; content?: string; size: number; type: string}>;
  /** 文件摘要信息 (summary 模式) */
  summary?: FileSummaryEntry[];
  /** 总大小 (字节) */
  totalSize?: number;
  /** 收集的文件数量 */
  count?: number;
  totalFiles?: number;
  /** 是否被截断 */
  truncated?: boolean;
  /** 返回模式 */
  returnMode?: ReturnMode;
}

/** collectCode 返回结果 */
export interface CollectCodeResult extends CollectorResult {
  tooltype: 'collect_code';
  data: CollectCodeData | null;
  suggestion?: string;
}

/** collectionDiff 返回结果 */
export interface CollectionDiffResult extends CollectorResult {
  tooltype: 'collection_diff';
  data: CollectionDiffData;
}

/** Collector 运行时服务（依赖注入） */
export interface CollectorRuntimeServices {
  collector: CodeCollector;
}

// ─── collectCode.ts ──────────────────────────────────────

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
export const collectCode = definePageTool({
  name: 'collect_code',
  requirePage: false,
  description:
    '从页面收集 JavaScript 代码，支持智能模式（summary/priority/incremental/full）。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    url: zod.string().url(),
    smartMode: zod
      .enum(['summary', 'priority', 'incremental', 'full'])
      .optional(),
    returnMode: zod
      .enum(['full', 'summary', 'pattern', 'top-priority'])
      .optional(),
    includeInline: zod.boolean().optional(),
    includeExternal: zod.boolean().optional(),
    includeDynamic: zod.boolean().optional(),
    maxTotalSize: zod.number().int().positive().optional(),
    maxFileSize: zod.number().int().positive().optional(),
    pattern: zod.string().optional(),
    limit: zod.number().int().positive().optional(),
    topN: zod.number().int().positive().optional(),
  },
  handler: async (request, response, context) => {
    const params = request.params as CollectCodeParams;
    const returnMode = params.returnMode ?? 'full';
    const collector = context.getCodeCollector?.();
    if (!collector) {
      throw createToolError(ErrorCodes.RUNTIME, 'CodeCollector 服务不可用', {
        toolName: 'collect_code',
      });
    }

    // Bind collector page resolver to the routed page without mutating global
    // selectedPage (so --pageId never switches the session's active tab).
    const selectedPage = context.getSelectedPage?.();
    if (selectedPage) {
      if (typeof collector.setPageResolver === 'function') {
        collector.setPageResolver(() => selectedPage);
      } else if (!request.params.pageId) {
        context.syncPageContext(selectedPage);
      }
    }

    const shouldCollect =
      returnMode !== 'summary' ||
      collector.getCollectedFilesSummary().length === 0;

    try {
      // 执行收集
      if (shouldCollect) {
        const collectResult = await collector.collect(
          params as CollectCodeOptions,
        );
        if (collectResult.error) {
          const isNoPage = collectResult.error === 'NO_PAGE_CONTEXT';
          throw createToolError(
            isNoPage ? ErrorCodes.PAGE_REQUIRED : ErrorCodes.RUNTIME,
            collectResult.message ?? collectResult.error,
            {toolName: 'collect_code'},
            {
              recovery: isNoPage
                ? {
                    tool: 'select_page',
                    command: 'browsercli select_page',
                    reason: 'A page must be selected first',
                  }
                : {
                    command: 'browsercli browser status',
                    reason: 'Check browser connection',
                  },
            },
          );
        }
      }

      let data: CollectCodeData;
      let message: string;

      if (returnMode === 'summary') {
        const summary =
          collector.getCollectedFilesSummary() as FileSummaryEntry[];
        data = {
          summary,
          count: summary.length,
          returnMode,
        };
        message = `代码摘要收集完成，共 ${summary.length} 个文件`;
      } else if (returnMode === 'pattern') {
        const patternResult = collector.getFilesByPattern(
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
        const priorityFiles = collector.getTopPriorityFiles(
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
          totalFiles:
            (priorityFiles as {totalFiles?: number}).totalFiles ??
            priorityFiles.files.length,
        };
        message = `高优先级文件收集完成，共 ${priorityFiles.files.length} 个`;
      } else {
        // full mode
        const fullResult = await collector.collect(params);
        data = {
          files: fullResult.files.map(file => ({
            url: file.url,
            content: file.content,
            size: file.size,
            type: file.type,
          })),
          totalSize: fullResult.totalSize,
          count: fullResult.files.length,
          truncated:
            fullResult.files.length >= (params.maxFileSize ?? Infinity),
          returnMode,
        };
        message = `代码全量收集完成，共 ${fullResult.files.length} 个文件，总大小 ${(fullResult.totalSize / 1024).toFixed(2)} KB`;
      }

      const result = {
        success: true,
        message,
        tooltype: 'collect_code',
        data: data,
      };
      response.setStructuredContent(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isNoPage =
        errorMsg.includes('NO_PAGE_CONTEXT') ||
        errorMsg.includes('pageResolver');
      throw createToolError(
        isNoPage ? ErrorCodes.PAGE_REQUIRED : ErrorCodes.RUNTIME,
        `代码收集失败：${errorMsg}`,
        {toolName: 'collect_code'},
      );
    }
  },
});

// ─── collectionDiff.ts ───────────────────────────────────

/**
 * 对比两次收集的文件摘要差异（标准 MCP 工具版本）。
 *
 * 使用 defineTool 包裹，符合项目工具定义规范，
 * 通过 response 对象返回结构化结果。
 */
export const collectionDiff = defineStatelessTool({
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
  handler: async (request, response, context) => {
    const params = request.params as CollectionDiffParams;

    try {
      const current: FileSummaryEntry[] = (params.current ??
        context.getCodeCollector?.().getCollectedFilesSummary() ??
        []) as FileSummaryEntry[];
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
      throw createToolError(ErrorCodes.RUNTIME, `对比失败：${errorMsg}`, {
        toolName: 'collection_diff',
      });
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

// ─── dumpTargetScripts.ts ────────────────────────────────

export const dumpTargetScripts = defineBrowserTool({
  name: 'dump_target_scripts',
  concurrency: 'none',
  description: '一次性读取指定 Chromium Target 当前已解析的脚本源码。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    targetId: zod
      .string()
      .min(1)
      .describe('从 list_targets 获取的 Target ID。'),
  },
  handler: async (request, response, context) => {
    try {
      if (typeof context.getBrowserTargetInspector !== 'function') {
        throw createToolError(
          ErrorCodes.RUNTIME,
          '当前工具运行时未提供 BrowserTargetInspector 上下文',
          {toolName: 'dump_target_scripts'},
        );
      }
      const result = await context
        .getBrowserTargetInspector()
        .dumpScripts(request.params.targetId);
      response.setStructuredContent({
        success: true,
        message: `已返回 ${result.scripts.length} 个 Target 脚本`,
        tooltype: 'dump_target_scripts',
        data: result,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'dump_target_scripts', targetId: request.params.targetId},
      );
    }
  },
});

// ─── listTargets.ts ──────────────────────────────────────

export const listTargets = defineBrowserTool({
  name: 'list_targets',
  concurrency: 'none',
  description: '列出 Chromium 当前可见的 Target 及其脚本快照能力。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response, context) => {
    try {
      if (typeof context.getBrowserTargetInspector !== 'function') {
        throw createToolError(
          ErrorCodes.RUNTIME,
          '当前工具运行时未提供 BrowserTargetInspector 上下文',
          {toolName: 'list_targets'},
        );
      }
      const targets = await context.getBrowserTargetInspector().listTargets();
      response.setStructuredContent({
        success: true,
        message: `已列出 ${targets.length} 个 Target`,
        tooltype: 'list_targets',
        data: {targets},
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'list_targets'},
      );
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'collector',
  description: 'Code and script collection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './collector.js', handlerName: 'collectCode'},
    {
      modulePath: './collector.js',
      handlerName: 'collectionDiff',
    },
    {modulePath: './collector.js', handlerName: 'listTargets'},
    {
      modulePath: './collector.js',
      handlerName: 'dumpTargetScripts',
    },
  ],
} satisfies DomainManifest;
