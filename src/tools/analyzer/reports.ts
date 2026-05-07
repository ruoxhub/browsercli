/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {TokenBudgetManager} from '../../utils/TokenBudgetManager.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

import type {
  CorrelatedFlow,
  PriorityTarget,
  SignatureChainHints,
} from './types.js';
import {toMirroredNetworkEntry, toMirroredScriptEntry} from './normalize.js';

export function buildActionPlan(result: {
  target: string;
  topHookIds: Array<{hookId: string; type: string}>;
  suspiciousFlows: Array<{
    url: string;
    method: string;
    signatureIndicators: string[];
  }>;
  priorityTargets: Array<{
    target: string;
    type: 'network' | 'function';
    priorityScore: number;
  }>;
  signatureHints: SignatureChainHints;
}): string[] {
  const steps: string[] = [];
  const addStep = (text: string) => {
    steps.push(`${steps.length + 1}) ${text}`);
  };
  addStep(
    `调用 collect_code，参数: {"url":"${result.target}","returnMode":"top-priority","topN":10}`,
  );

  if (result.suspiciousFlows.length > 0) {
    const flow = result.suspiciousFlows[0];
    addStep(
      `重点观察可疑请求: ${flow.method} ${flow.url}，命中指标: ${flow.signatureIndicators.join(', ')}`,
    );
  } else {
    addStep(
      '先触发登录/下单/关键业务操作，再重新运行 analyze_target 捕获动态请求',
    );
  }

  if (result.priorityTargets.length > 0) {
    const top = result.priorityTargets[0];
    if (top.type === 'network') {
      addStep(
        `优先复现网络链路: ${top.target}（priority=${top.priorityScore}）`,
      );
    } else {
      addStep(`优先审计函数: ${top.target}（priority=${top.priorityScore}）`);
    }
  }

  if (result.signatureHints.candidateFunctions.length > 0) {
    const fnName = result.signatureHints.candidateFunctions[0];
    addStep(
      `使用 search_in_scripts 搜索函数名 "${fnName}"，并用 understand_code 深挖调用链`,
    );
  } else {
    addStep(
      '使用 search_in_scripts 搜索关键词 sign/token/auth/nonce，定位签名生成点',
    );
  }

  if (result.topHookIds.length > 0) {
    addStep(
      `调用 get_hook_data 查看首个 hook 数据: {"hookId":"${result.topHookIds[0].hookId}"}`,
    );
  } else {
    addStep('用 create_hook + inject_hook 手工注入 fetch/xhr hook 后再采样');
  }

  addStep(
    '对疑似签名代码调用 deobfuscate_code（aggressive=true）并复测请求参数变化',
  );
  return steps;
}

export function buildWhyTheseSteps(input: {
  requestFingerprints: Array<{fingerprint: string}>;
  candidateFunctions: string[];
  hookRecordCount: number;
}): string[] {
  return [
    input.requestFingerprints.length > 0
      ? `观察到可疑的请求指纹：${input.requestFingerprints
          .slice(0, 2)
          .map(item => item.fingerprint)
          .join('；')}`
      : '尚未捕获稳定请求指纹，后续步骤将继续观察和轻量采集。',
    input.candidateFunctions.length > 0
      ? `找到候选签名函数：${input.candidateFunctions.slice(0, 3).join('、')}`
      : '未发现明显的签名函数名，工作流将优先依赖请求和 Hook 证据。',
    input.hookRecordCount > 0
      ? `Hook 已采集到 ${input.hookRecordCount} 条记录，足以开始关联分析和本地重建。`
      : 'Hook 尚未产出数据，应避免过早进行本地重建猜测。',
  ];
}

export function buildStopConditions(input: {
  hookRecordCount: number;
  suspiciousFlowCount: number;
}): string[] {
  return [
    input.suspiciousFlowCount > 0
      ? '目标请求路径确认后即可停止扩大采集范围，并导出重建 Bundle。'
      : '若尚未确认可疑请求路径，应先触发目标操作后再停止分析。',
    input.hookRecordCount > 200
      ? 'Hook 数据超过 200 条时应先降噪（summary 视图或缩小目标），再决定是否注入新 Hook。'
      : 'Hook 证据不足以定位问题时，再考虑升级到断点调试。',
  ];
}

/**
 * 记录逆向分析证据。
 *
 * 将逆向分析过程中发现的关键证据结构化记录，
 * 供后续导出会话报告使用。
 *
 * @param params - 证据参数
 * @returns 结构化结果对象
 */
export const record_reverse_evidence = defineTool({
  name: 'record_reverse_evidence',
  description: 'Append structured reverse-engineering evidence to a task artifact log.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    taskId: zod.string(),
    taskSlug: zod.string(),
    targetUrl: zod.string(),
    goal: zod.string(),
    channel: zod.string().default('runtime-evidence'),
    targetKeywords: zod.array(zod.string()).optional(),
    targetUrlPatterns: zod.array(zod.string()).optional(),
    targetFunctionNames: zod.array(zod.string()).optional(),
    targetActionDescription: zod.string().optional(),
    entry: zod.record(zod.string(), zod.unknown()),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    const task = await runtime.reverseTaskStore.openTask({
      taskId: request.params.taskId,
      slug: request.params.taskSlug,
      targetUrl: request.params.targetUrl,
      goal: request.params.goal,
    });
    const targetContext = {
      targetKeywords: request.params.targetKeywords ?? [],
      targetUrlPatterns: request.params.targetUrlPatterns ?? [],
      targetFunctionNames: request.params.targetFunctionNames ?? [],
      targetActionDescription: request.params.targetActionDescription ?? '',
    };
    const hasTargetContext = targetContext.targetKeywords.length > 0 ||
      targetContext.targetUrlPatterns.length > 0 ||
      targetContext.targetFunctionNames.length > 0 ||
      targetContext.targetActionDescription.length > 0;

    const artifactEntry = {
      ...request.params.entry,
      ...(hasTargetContext ? {targetContext} : {}),
    };

    await task.appendLog(request.params.channel, artifactEntry);

    const mirroredChannels: string[] = [];
    if (request.params.channel === 'runtime-evidence') {
      const mirroredNetworkEntry = toMirroredNetworkEntry(request.params.entry);
      if (mirroredNetworkEntry) {
        await task.appendLog('network', mirroredNetworkEntry);
        mirroredChannels.push('network');
      }
      const mirroredScriptEntry = toMirroredScriptEntry(request.params.entry);
      if (mirroredScriptEntry) {
        await task.appendLog('scripts', mirroredScriptEntry);
        mirroredChannels.push('scripts');
      }
    }

    if (hasTargetContext) {
      const existingTargetContext = await runtime.reverseTaskStore.readSnapshot<Record<string, unknown>>(
        request.params.taskId,
        'target-context.json',
      );
      await task.writeSnapshot('target-context.json', {
        ...existingTargetContext,
        ...targetContext,
      });
    }

    response.setStructuredContent({
        ok: true,
        taskId: task.taskId,
        taskDir: task.taskDir,
        channel: request.params.channel,
        logFormat: 'json',
        mirroredChannels,
        targetContext: hasTargetContext ? targetContext : undefined,
      });
  },
});

/**
 * 导出会话报告。
 *
 * 汇总当前逆向分析会话中的所有证据和发现，
 * 生成结构化的会话报告。
 *
 * @param params - 报告参数
 * @returns 结构化结果对象
 */
export const export_session_report = defineTool({
  name: 'export_session_report',
  description: 'Export current reverse-engineering session as JSON or Markdown.',
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
    const totalHookRecords = runtime.hookManager.getAllKnownHookIds().reduce(
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
      hookData: request.params.includeHookData ? runtime.hookManager.exportData('json') : undefined,
    };

    if (request.params.format === 'markdown') {
      const markdown = toMarkdownReport(report);
      response.appendResponseLine(markdown);
      return;
    }

    response.setStructuredContent({
        success: true,
        message: `会话报告已导出 (格式: ${request.params.format})`,
        tooltype: 'export_session_report',
        logFormat: 'json',
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
}): string {
  return [
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
  ].join('\n');
}
