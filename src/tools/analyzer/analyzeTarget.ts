/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';

import {executeAnalysis} from './analysisExecution.js';
import {
  buildRequestFingerprints,
  buildPriorityTargets,
} from './fingerprints.js';
import {correlateNetworkFlows} from './flows.js';
import {pickHookTypes} from './hooks.js';
import {normalizeCollectedFiles} from './normalize.js';
import {
  buildActionPlan,
  buildWhyTheseSteps,
  buildStopConditions,
} from './reports.js';
import {extractSignatureChainHints} from './signature.js';
import {buildHookTimeline} from './timeline.js';
import type {
  AnalyzerRuntimeServices,
  HookPreset,
  CollectedFileEntry,
  AnalyzeTargetData,
  HookTimelineEntry,
} from './types.js';

// Tunable thresholds; centralized so they are easy to find and adjust.
const DEFAULT_TOP_N = 8;
const COLLECT_TIMEOUT_MS = 30_000;
const UNDERSTAND_TIMEOUT_MS = 180_000;
const ANALYSIS_CODE_LIMIT = 300_000;
const DEFAULT_CORRELATION_WINDOW_MS = 1500;
const DEFAULT_MAX_CORRELATED_FLOWS = 20;
const DEFAULT_MAX_FINGERPRINTS = 12;
const DEFAULT_ACTIVE_URLS_LIMIT = 10;
const DEFAULT_SUSPICIOUS_FLOWS_LIMIT = 10;
const DEFAULT_TIMELINE_SAMPLE_LIMIT = 30;
const DEFAULT_PRIORITY_TARGETS = 10;

const EMPTY_DEPENDENCIES: {nodes: unknown[]; edges: unknown[]} = {
  nodes: [],
  edges: [],
};

export interface AnalyzeTargetParams {
  url: string;
  topN?: number;
  useAI?: boolean;
  hookPreset?: HookPreset;
  autoInjectHooks?: boolean;
  waitAfterHookMs?: number;
  correlationWindowMs?: number;
  maxCorrelatedFlows?: number;
  maxFingerprints?: number;
  autoReplayActions?: Array<{
    action:
      | 'navigate'
      | 'click'
      | 'type'
      | 'wait'
      | 'scroll'
      | 'pressKey'
      | 'evaluate';
    url?: string;
    selector?: string;
    text?: string;
    delay?: number;
    timeout?: number;
    x?: number;
    y?: number;
    key?: string;
    code?: string;
  }>;
  collect?: {
    smartMode?: 'summary' | 'priority' | 'incremental' | 'full';
    includeInline?: boolean;
    includeExternal?: boolean;
    includeDynamic?: boolean;
    maxTotalSize?: number;
    maxFileSize?: number;
  };
}

interface CollectedCode {
  collectResult: unknown;
  normalizedFiles: CollectedFileEntry[];
  candidateFiles: CollectedFileEntry[];
  analysisCode: string;
}

async function collectAnalyzeTargetCode(
  runtime: AnalyzerRuntimeServices,
  params: AnalyzeTargetParams,
): Promise<CollectedCode> {
  const topN = params.topN ?? DEFAULT_TOP_N;
  const collectResult = await runtime.collector.collect({
    url: params.url,
    smartMode: params.collect?.smartMode ?? 'priority',
    includeInline: params.collect?.includeInline,
    includeExternal: params.collect?.includeExternal,
    includeDynamic: params.collect?.includeDynamic ?? true,
    maxTotalSize: params.collect?.maxTotalSize,
    maxFileSize: params.collect?.maxFileSize,
  });

  const normalizedFiles = normalizeCollectedFiles(collectResult);
  const topPriority = runtime.collector.getTopPriorityFiles(topN);
  const candidateFiles =
    topPriority.files.length > 0
      ? topPriority.files
      : normalizedFiles.slice(0, topN);
  const mergedCode = candidateFiles
    .map(file => `// ${file.url}\n${file.content}`)
    .join('\n\n');
  const analysisCode =
    mergedCode.length > ANALYSIS_CODE_LIMIT
      ? mergedCode.slice(0, ANALYSIS_CODE_LIMIT)
      : mergedCode;
  return {collectResult, normalizedFiles, candidateFiles, analysisCode};
}

interface InstalledHook {
  hookId: string;
  type: string;
  injected: boolean;
}

async function installAnalyzeHooks(
  runtime: AnalyzerRuntimeServices,
  hookPreset: HookPreset,
  autoInjectHooks: boolean,
): Promise<InstalledHook[]> {
  const injectedHooks: InstalledHook[] = [];
  for (const type of pickHookTypes(hookPreset)) {
    const created = runtime.hookManager.create({
      type,
      description: `[analyze_target] ${type} hook`,
      action: 'log',
    });
    let injected = false;
    if (autoInjectHooks) {
      try {
        await runtime.pageController.injectScript(created.script);
        injected = true;
      } catch {
        injected = false;
      }
    }
    injectedHooks.push({hookId: created.hookId, type, injected});
  }
  return injectedHooks;
}

function extractCollectionDependencies(collectResult: unknown): {
  nodes: unknown[];
  edges: unknown[];
} {
  if (!collectResult || typeof collectResult !== 'object') {
    return EMPTY_DEPENDENCIES;
  }
  const dependencies = (
    collectResult as {dependencies?: {nodes: unknown[]; edges: unknown[]}}
  ).dependencies;
  return dependencies ?? EMPTY_DEPENDENCIES;
}

function buildActiveUrls(
  timeline: HookTimelineEntry[],
): Array<{url: string; count: number}> {
  const urlActivity = timeline.reduce<Record<string, number>>((acc, item) => {
    if (item.url) {
      acc[item.url] = (acc[item.url] ?? 0) + 1;
    }
    return acc;
  }, {});
  return Object.entries(urlActivity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, DEFAULT_ACTIVE_URLS_LIMIT)
    .map(([url, count]) => ({url, count}));
}

function buildNextActions(input: {
  cryptoAlgorithmCount: number;
  hookTimelineLength: number;
  hasSecurityRisks: boolean;
}): string[] {
  const actions: string[] = [];
  if (input.cryptoAlgorithmCount > 0) {
    actions.push('Focus on crypto-related files from top-priority list.');
  }
  if (input.hookTimelineLength === 0) {
    actions.push(
      'Trigger page interactions and rerun get_hook_data / analyze_target.',
    );
  }
  if (input.hasSecurityRisks) {
    actions.push(
      'Review high-severity security findings and verify call stacks.',
    );
  }
  return actions;
}

export const analyze_target = defineTool({
  name: 'analyze_target',
  description:
    '一键式逆向工作流：收集代码、进行安全/加密分析，并关联 Hook 时间线。',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().url(),
    topN: zod.number().int().positive().optional(),
    useAI: zod.boolean().optional(),
    hookPreset: zod.enum(['none', 'api-signature', 'network-core']).optional(),
    autoInjectHooks: zod.boolean().optional(),
    waitAfterHookMs: zod.number().int().nonnegative().optional(),
    correlationWindowMs: zod.number().int().positive().optional(),
    maxCorrelatedFlows: zod.number().int().positive().optional(),
    maxFingerprints: zod.number().int().positive().optional(),
    autoReplayActions: zod
      .array(
        zod.object({
          action: zod.enum([
            'navigate',
            'click',
            'type',
            'wait',
            'scroll',
            'pressKey',
            'evaluate',
          ]),
          url: zod.string().url().optional(),
          selector: zod.string().optional(),
          text: zod.string().optional(),
          delay: zod.number().int().nonnegative().optional(),
          timeout: zod.number().int().positive().optional(),
          x: zod.number().optional(),
          y: zod.number().optional(),
          key: zod.string().optional(),
          code: zod.string().optional(),
        }),
      )
      .optional(),
    collect: zod
      .object({
        smartMode: zod
          .enum(['summary', 'priority', 'incremental', 'full'])
          .optional(),
        includeInline: zod.boolean().optional(),
        includeExternal: zod.boolean().optional(),
        includeDynamic: zod.boolean().optional(),
        maxTotalSize: zod.number().int().positive().optional(),
        maxFileSize: zod.number().int().positive().optional(),
      })
      .optional(),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    const params = request.params;

    const startedAt = Date.now();
    const hookPreset = params.hookPreset ?? 'api-signature';
    const autoInjectHooks = params.autoInjectHooks ?? true;
    const correlationWindowMs =
      params.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW_MS;
    const maxCorrelatedFlows =
      params.maxCorrelatedFlows ?? DEFAULT_MAX_CORRELATED_FLOWS;
    const maxFingerprints = params.maxFingerprints ?? DEFAULT_MAX_FINGERPRINTS;

    const {collectResult, normalizedFiles, candidateFiles, analysisCode} =
      await withOperationTimeout(
        collectAnalyzeTargetCode(runtime, params as AnalyzeTargetParams),
        'analyze_target 代码收集',
        COLLECT_TIMEOUT_MS,
      );
    const injectedHooks = await installAnalyzeHooks(
      runtime,
      hookPreset,
      autoInjectHooks,
    );

    const replayResults = params.autoReplayActions?.length
      ? await runtime.pageController.replayActions(
          params.autoReplayActions as Parameters<
            typeof runtime.pageController.replayActions
          >[0],
        )
      : [];

    if (params.waitAfterHookMs && params.waitAfterHookMs > 0) {
      await new Promise(resolve => setTimeout(resolve, params.waitAfterHookMs));
    }

    const crypto = await runtime.cryptoDetector.detect({code: analysisCode});

    const understandResult = await executeAnalysis({
      toolName: 'analyze_target',
      useAI: params.useAI ?? true,
      timeoutMs: UNDERSTAND_TIMEOUT_MS,
      localAnalysis: () =>
        runtime.analyzer.understand({
          code: analysisCode,
          focus: 'security',
          useAI: false,
        }),
      aiEnrichment: () =>
        runtime.analyzer.understand({
          code: analysisCode,
          focus: 'security',
          useAI: true,
        }),
    });
    const understand = understandResult.data;

    const hookRecords = injectedHooks.map(hook => ({
      hookId: hook.hookId,
      records: runtime.hookManager.getRecords(hook.hookId) as Array<
        Record<string, unknown>
      >,
    }));

    const hookTimeline = buildHookTimeline(hookRecords);
    const activeUrls = buildActiveUrls(hookTimeline);
    const correlatedFlows = correlateNetworkFlows(
      hookTimeline,
      correlationWindowMs,
      maxCorrelatedFlows,
    );
    const suspiciousFlows = correlatedFlows.filter(
      flow => flow.signatureIndicators.length > 0,
    );
    const requestFingerprints = buildRequestFingerprints(
      correlatedFlows,
      maxFingerprints,
    );
    const signatureHints = extractSignatureChainHints(analysisCode);
    const priorityTargets = buildPriorityTargets({
      requestFingerprints,
      signatureHints,
      maxTargets: DEFAULT_PRIORITY_TARGETS,
    });
    const actionPlan = buildActionPlan({
      target: params.url,
      topHookIds: injectedHooks,
      suspiciousFlows,
      priorityTargets,
      signatureHints,
    });

    const result: AnalyzeTargetData = {
      target: params.url,
      durationMs: Date.now() - startedAt,
      collection: {
        totalCollected: normalizedFiles.length,
        selectedForAnalysis: candidateFiles.length,
        dependencies: extractCollectionDependencies(collectResult),
      },
      analysis: {
        qualityScore: understand.qualityScore ?? 0,
        securityRiskCount: understand.securityRisks?.length ?? 0,
        cryptoAlgorithms: crypto.algorithms.map(item => item.name),
      },
      deobfuscation: null,
      hooks: {
        preset: hookPreset,
        autoInjected: autoInjectHooks,
        hookIds: injectedHooks,
        totalRecords: hookTimeline.length,
        activeUrls,
        correlatedFlows,
        suspiciousFlows: suspiciousFlows.slice(
          0,
          DEFAULT_SUSPICIOUS_FLOWS_LIMIT,
        ),
        timelineSample: hookTimeline.slice(0, DEFAULT_TIMELINE_SAMPLE_LIMIT),
      },
      requestFingerprints,
      priorityTargets,
      signatureChain: signatureHints,
      actionPlan,
      recommendedNextSteps: actionPlan,
      whyTheseSteps: buildWhyTheseSteps({
        requestFingerprints,
        candidateFunctions: signatureHints.candidateFunctions,
        hookRecordCount: hookTimeline.length,
      }),
      stopIf: buildStopConditions({
        hookRecordCount: hookTimeline.length,
        suspiciousFlowCount: suspiciousFlows.length,
      }),
      nextActions: buildNextActions({
        cryptoAlgorithmCount: crypto.algorithms.length,
        hookTimelineLength: hookTimeline.length,
        hasSecurityRisks: (understand.securityRisks?.length ?? 0) > 0,
      }),
      replay: replayResults,
    };

    response.setStructuredContent({
      success: true,
      message: `分析完成，目标: ${params.url}`,
      tooltype: 'analyze_target',
      meta: understandResult.meta,
      data: result,
    });
  },
});
