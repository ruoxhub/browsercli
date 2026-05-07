/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
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
  AnalyzeTargetResult,
  AnalyzerRuntimeServices,
  HookPreset,
  CollectedFileEntry,
} from './types.js';

export interface AnalyzeTargetParams {
  url: string;
  topN?: number;
  useAI?: boolean;
  runDeobfuscation?: boolean;
  hookPreset?: HookPreset;
  autoInjectHooks?: boolean;
  waitAfterHookMs?: number;
  correlationWindowMs?: number;
  maxCorrelatedFlows?: number;
  maxFingerprints?: number;
  autoReplayActions?: Array<{
    action: 'navigate' | 'click' | 'type' | 'wait' | 'scroll' | 'pressKey' | 'evaluate';
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

async function collectAnalyzeTargetCode(
  runtime: AnalyzerRuntimeServices,
  params: AnalyzeTargetParams,
): Promise<{
  collectResult: unknown;
  normalizedFiles: CollectedFileEntry[];
  candidateFiles: CollectedFileEntry[];
  analysisCode: string;
}> {
  const topN = params.topN ?? 8;
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
    topPriority.files.length > 0 ? topPriority.files : normalizedFiles.slice(0, topN);
  const mergedCode = candidateFiles
    .map(file => `// ${file.url}\n${file.content}`)
    .join('\n\n');
  const analysisCode = mergedCode.length > 300000 ? mergedCode.slice(0, 300000) : mergedCode;
  return {collectResult, normalizedFiles, candidateFiles, analysisCode};
}

async function installAnalyzeHooks(
  runtime: AnalyzerRuntimeServices,
  hookPreset: HookPreset,
  autoInjectHooks: boolean,
): Promise<Array<{hookId: string; type: string; injected: boolean}>> {
  const injectedHooks: Array<{hookId: string; type: string; injected: boolean}> = [];
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

export const analyze_target = defineTool({
  name: 'analyze_target',
  description: 'One-shot reverse workflow: collect code, run security/crypto analysis, optional deobfuscation, and hook timeline correlation.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    url: zod.string().url(),
    topN: zod.number().int().positive().optional(),
    useAI: zod.boolean().optional(),
    runDeobfuscation: zod.boolean().optional(),
    hookPreset: zod.enum(['none', 'api-signature', 'network-core']).optional(),
    autoInjectHooks: zod.boolean().optional(),
    waitAfterHookMs: zod.number().int().nonnegative().optional(),
    correlationWindowMs: zod.number().int().positive().optional(),
    maxCorrelatedFlows: zod.number().int().positive().optional(),
    maxFingerprints: zod.number().int().positive().optional(),
    autoReplayActions: zod.array(zod.object({
      action: zod.enum(['navigate', 'click', 'type', 'wait', 'scroll', 'pressKey', 'evaluate']),
      url: zod.string().url().optional(),
      selector: zod.string().optional(),
      text: zod.string().optional(),
      delay: zod.number().int().nonnegative().optional(),
      timeout: zod.number().int().positive().optional(),
      x: zod.number().optional(),
      y: zod.number().optional(),
      key: zod.string().optional(),
      code: zod.string().optional(),
    })).optional(),
    collect: zod.object({
      smartMode: zod.enum(['summary', 'priority', 'incremental', 'full']).optional(),
      includeInline: zod.boolean().optional(),
      includeExternal: zod.boolean().optional(),
      includeDynamic: zod.boolean().optional(),
      maxTotalSize: zod.number().int().positive().optional(),
      maxFileSize: zod.number().int().positive().optional(),
    }).optional(),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    const params = request.params;
    
    if (!params?.url) {
      response.setStructuredContent<AnalyzeTargetResult>({
        success: false,
        message: 'analyze_target requires a "url" parameter',
        tooltype: 'analyze_target',
        logFormat: 'json',
        data: {
          target: '',
          durationMs: 0,
          collection: {
            totalCollected: 0,
            selectedForAnalysis: 0,
            dependencies: {nodes: [], edges: []},
          },
          analysis: {qualityScore: 0, securityRiskCount: 0, cryptoAlgorithms: []},
          deobfuscation: null,
          hooks: {
            preset: 'none',
            autoInjected: false,
            hookIds: [],
            totalRecords: 0,
            activeUrls: [],
            correlatedFlows: [],
            suspiciousFlows: [],
            timelineSample: [],
          },
          requestFingerprints: [],
          priorityTargets: [],
          signatureChain: {signatureParams: [], candidateFunctions: [], requestSinks: []},
          actionPlan: [],
          recommendedNextSteps: [],
          whyTheseSteps: [],
          stopIf: [],
          nextActions: [],
        },
      });
      return;
    }

    const startedAt = Date.now();
    const hookPreset = params.hookPreset ?? 'api-signature';
    const autoInjectHooks = params.autoInjectHooks ?? true;
    const correlationWindowMs = params.correlationWindowMs ?? 1500;
    const maxCorrelatedFlows = params.maxCorrelatedFlows ?? 20;
    const maxFingerprints = params.maxFingerprints ?? 12;

    const {collectResult, normalizedFiles, candidateFiles, analysisCode} =
      await withOperationTimeout(
        collectAnalyzeTargetCode(runtime, params),
        'analyze_target 代码收集',
        10000,
      );
    const injectedHooks = await installAnalyzeHooks(runtime, hookPreset, autoInjectHooks);

    const replayResults = params.autoReplayActions?.length
      ? await runtime.pageController.replayActions(params.autoReplayActions)
      : [];

    if (params.waitAfterHookMs && params.waitAfterHookMs > 0) {
      await new Promise(resolve => setTimeout(resolve, params.waitAfterHookMs));
    }

    const [understand, crypto] = await withOperationTimeout(
      Promise.all([
        runtime.analyzer.understand({code: analysisCode, focus: 'security'}),
        runtime.cryptoDetector.detect({code: analysisCode}),
      ]),
      'analyze_target 安全分析',
      10000,
    );

    const deobfuscation = params.runDeobfuscation
      ? await runtime.deobfuscator.deobfuscate({
            code: analysisCode.slice(0, 120000),
            aggressive: true,
            renameVariables: true,
          })
      : undefined;

    const hookRecords = injectedHooks.map(hook => ({
      hookId: hook.hookId,
      records: runtime.hookManager.getRecords(hook.hookId) as Array<Record<string, unknown>>,
    }));

    const hookTimeline = buildHookTimeline(hookRecords);
    const urlActivity = hookTimeline.reduce<Record<string, number>>((acc, item) => {
      if (item.url) {
        acc[item.url] = (acc[item.url] ?? 0) + 1;
      }
      return acc;
    }, {});
    const activeUrls = Object.entries(urlActivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([url, count]) => ({url, count}));

    const correlatedFlows = correlateNetworkFlows(hookTimeline, correlationWindowMs, maxCorrelatedFlows);
    const suspiciousFlows = correlatedFlows.filter(flow => flow.signatureIndicators.length > 0);
    const requestFingerprints = buildRequestFingerprints(correlatedFlows, maxFingerprints);
    const signatureHints = extractSignatureChainHints(analysisCode);
    const priorityTargets = buildPriorityTargets({
      requestFingerprints,
      signatureHints,
      maxTargets: 10,
    });
    const actionPlan = buildActionPlan({
      target: params.url,
      topHookIds: injectedHooks,
      suspiciousFlows,
      priorityTargets,
      signatureHints,
    });

    const collectionDependencies:
      | {nodes: unknown[]; edges: unknown[]}
      | undefined =
      collectResult && typeof collectResult === 'object'
        ? (collectResult as {dependencies?: {nodes: unknown[]; edges: unknown[]}}).dependencies
        : undefined;

    const result = {
      target: params.url,
      durationMs: Date.now() - startedAt,
      collection: {
        totalCollected: normalizedFiles.length,
        selectedForAnalysis: candidateFiles.length,
        dependencies: collectionDependencies ?? {nodes: [], edges: []},
      },
      analysis: {
        qualityScore: understand.qualityScore ?? 0,
        securityRiskCount: understand.securityRisks?.length ?? 0,
        cryptoAlgorithms: crypto.algorithms.map((item: {name: string}) => item.name),
      },
      deobfuscation: deobfuscation
        ? {
              confidence: deobfuscation.confidence,
              readabilityScore: deobfuscation.readabilityScore,
              transformations: deobfuscation.transformations.length,
            }
        : null,
      hooks: {
        preset: hookPreset,
        autoInjected: autoInjectHooks,
        hookIds: injectedHooks,
        totalRecords: hookTimeline.length,
        activeUrls,
        correlatedFlows,
        suspiciousFlows: suspiciousFlows.slice(0, 10),
        timelineSample: hookTimeline.slice(0, 30),
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
      nextActions: [
        crypto.algorithms.length > 0
          ? 'Focus on crypto-related files from top-priority list.'
          : null,
        hookTimeline.length === 0
          ? 'Trigger page interactions and rerun get_hook_data / analyze_target.'
          : null,
        understand.securityRisks?.length > 0
          ? 'Review high-severity security findings and verify call stacks.'
          : null,
      ].filter((item): item is string => Boolean(item)),
      replay: replayResults,
    };

    response.setStructuredContent({
      success: true,
      message: `分析完成，目标: ${params.url}`,
      tooltype: 'analyze_target',
      // logFormat: 'json',
      data: result,
    });
  },
});
