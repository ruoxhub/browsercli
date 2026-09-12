/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {TokenBudgetManager} from '../../utils/TokenBudgetManager.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {toMirroredNetworkEntry, toMirroredScriptEntry} from './normalize.js';

const NETWORK_CHANNEL = 'runtime-evidence';

function getMissingEvidenceFields(params: {
  taskId?: string;
  taskSlug?: string;
  targetUrl?: string;
  goal?: string;
}): string[] {
  const required: Array<keyof typeof params> = [
    'taskId',
    'taskSlug',
    'targetUrl',
    'goal',
  ];
  return required.filter(field => !params[field]);
}

function buildTargetContext(params: {
  targetKeywords?: string[];
  targetUrlPatterns?: string[];
  targetFunctionNames?: string[];
  targetActionDescription?: string;
}) {
  return {
    targetKeywords: params.targetKeywords ?? [],
    targetUrlPatterns: params.targetUrlPatterns ?? [],
    targetFunctionNames: params.targetFunctionNames ?? [],
    targetActionDescription: params.targetActionDescription ?? '',
  };
}

function hasMeaningfulTargetContext(
  targetContext: ReturnType<typeof buildTargetContext>,
): boolean {
  return (
    targetContext.targetKeywords.length > 0 ||
    targetContext.targetUrlPatterns.length > 0 ||
    targetContext.targetFunctionNames.length > 0 ||
    targetContext.targetActionDescription.length > 0
  );
}

/**
 * 记录逆向分析证据。
 *
 * 将逆向分析过程中发现的关键证据结构化记录，
 * 供后续导出会话报告使用。
 */
export const record_reverse_evidence = defineTool({
  name: 'record_reverse_evidence',
  description: '将结构化的逆向工程证据追加到任务产物日志中。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    taskId: zod.string().optional().default('default'),
    taskSlug: zod.string().optional().default('default'),
    targetUrl: zod.string().optional().default(''),
    goal: zod.string().optional().default(''),
    channel: zod.string().default(NETWORK_CHANNEL),
    targetKeywords: zod.array(zod.string()).optional(),
    targetUrlPatterns: zod.array(zod.string()).optional(),
    targetFunctionNames: zod.array(zod.string()).optional(),
    targetActionDescription: zod.string().optional(),
    entry: zod.record(zod.string(), zod.unknown()),
  },
  handler: async (request, response) => {
    try {
      // Defensive normalization: entry may be undefined or non-object.
      const rawEntry = request.params.entry;
      const safeEntry: Record<string, unknown> =
        rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
          ? (rawEntry as Record<string, unknown>)
          : {};

      // Required-field fallback (zod.record introspection cannot enforce shape here).
      const missing = getMissingEvidenceFields(request.params);
      if (missing.length > 0) {
        throw createToolError(
          ErrorCodes.VALIDATION,
          `缺少必填参数：${missing.join(', ')}`,
          {toolName: 'record_reverse_evidence'},
        );
      }

      const runtime = getRuntime();
      const task = await runtime.reverseTaskStore.openTask({
        taskId: request.params.taskId,
        slug: request.params.taskSlug,
        targetUrl: request.params.targetUrl,
        goal: request.params.goal,
      });
      const targetContext = buildTargetContext(request.params);
      const hasTargetContext = hasMeaningfulTargetContext(targetContext);

      const artifactEntry = {
        ...safeEntry,
        ...(hasTargetContext ? {targetContext} : {}),
      };

      const channel = request.params.channel ?? NETWORK_CHANNEL;
      await task.appendLog(channel, artifactEntry);

      const mirroredChannels: string[] = [];
      if (channel === NETWORK_CHANNEL) {
        const mirroredNetworkEntry = toMirroredNetworkEntry(safeEntry);
        if (mirroredNetworkEntry) {
          await task.appendLog('network', mirroredNetworkEntry);
          mirroredChannels.push('network');
        }
        const mirroredScriptEntry = toMirroredScriptEntry(safeEntry);
        if (mirroredScriptEntry) {
          await task.appendLog('scripts', mirroredScriptEntry);
          mirroredChannels.push('scripts');
        }
      }

      if (hasTargetContext) {
        const existingTargetContext =
          await runtime.reverseTaskStore.readSnapshot<Record<string, unknown>>(
            request.params.taskId,
            'target-context.json',
          );
        await task.writeSnapshot('target-context.json', {
          ...existingTargetContext,
          ...targetContext,
        });
      }

      response.setStructuredContent({
        success: true,
        message: 'Evidence recorded',
        tooltype: 'record_reverse_evidence',
        data: {
          ok: true,
          taskId: task.taskId,
          taskDir: task.taskDir,
          channel,
          mirroredChannels,
          entryProvided: rawEntry !== undefined,
          targetContext: hasTargetContext ? targetContext : undefined,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `记录证据失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'record_reverse_evidence'},
      );
    }
  },
});

/**
 * 导出会话报告。
 *
 * 汇总当前逆向分析会话中的所有证据和发现，
 * 生成结构化的会话报告。
 */
export const export_session_report = defineTool({
  name: 'export_session_report',
  description: '将当前逆向工程会话导出为 JSON 或 Markdown。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    format: zod.enum(['json', 'markdown']).default('json'),
    includeHookData: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    const summaries = runtime.collector.getCollectedFilesSummary();
    const collectorStats = await runtime.collector.getAllStats();
    const hookStats = runtime.hookManager.getStats();
    const totalHookRecords = runtime.hookManager
      .getAllKnownHookIds()
      .reduce(
        (sum, hookId) => sum + runtime.hookManager.getRecords(hookId).length,
        0,
      );
    const tokenStats = TokenBudgetManager.getInstance().getStats();

    const report = {
      generatedAt: new Date().toISOString(),
      collector: {
        totalFiles: summaries.length,
        totalBytes: summaries.reduce((sum, file) => sum + file.size, 0),
        cacheStats: collectorStats,
      },
      hooks: {
        ...hookStats,
        totalRecords: totalHookRecords,
      },
      tokenBudget: {
        usedTokens: tokenStats.currentUsage,
        maxTokens: tokenStats.maxTokens,
        usagePercent: tokenStats.usagePercentage,
      },
      hookData: request.params.includeHookData
        ? runtime.hookManager.exportData('json')
        : undefined,
    };

    if (request.params.format === 'markdown') {
      const markdown = toMarkdownReport(report);
      response.setStructuredContent({
        success: true,
        message: `会话报告已导出 (格式: markdown)`,
        tooltype: 'export_session_report',
        data: {format: 'markdown', markdown},
      });
      return;
    }

    response.setStructuredContent({
      success: true,
      message: `会话报告已导出 (格式: ${request.params.format})`,
      tooltype: 'export_session_report',
      data: report,
    });
  },
});

// Helper function for markdown report
function toMarkdownReport(report: {
  generatedAt: string;
  collector: {
    totalFiles: number;
    totalBytes: number;
  };
  hooks: {
    totalHooks: number;
    enabledHooks: number;
    totalRecords: number;
  };
  tokenBudget: {
    usedTokens: number;
    maxTokens: number;
    usagePercent: number;
  };
  hookData?: unknown;
}): string {
  const sections = [
    '# Session Report',
    '',
    `Generated At: ${report.generatedAt}`,
    '',
    '## Collector',
    `- Files: ${report.collector.totalFiles}`,
    `- Total Bytes: ${report.collector.totalBytes}`,
    '',
    '## Hooks',
    `- Total Hooks: ${report.hooks.totalHooks}`,
    `- Enabled Hooks: ${report.hooks.enabledHooks}`,
    `- Total Records: ${report.hooks.totalRecords}`,
    '',
    '## Token Budget',
    `- Used: ${report.tokenBudget.usedTokens}/${report.tokenBudget.maxTokens}`,
    `- Usage: ${report.tokenBudget.usagePercent.toFixed(2)}%`,
  ];

  if (report.hookData !== undefined) {
    sections.push(
      '',
      '## Hook Data',
      typeof report.hookData === 'string'
        ? report.hookData
        : JSON.stringify(report.hookData, null, 2),
    );
  }

  return sections.join('\n');
}
