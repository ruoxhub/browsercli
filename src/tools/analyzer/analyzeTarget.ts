/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {buildHookTimeline} from './timeline.js';
import {correlateNetworkFlows} from './flows.js';
import {
  buildUrlPattern,
  buildRequestFingerprints,
  buildPriorityTargets,
} from './fingerprints.js';
import {extractSignatureChainHints} from './signature.js';
import {buildActionPlan, buildWhyTheseSteps, buildStopConditions} from './reports.js';
import {pickHookTypes} from './hooks.js';
import type {
  AnalyzeTargetResult,
  HookPreset,
  HookTimelineEntry,
  CorrelatedFlow,
  RequestFingerprint,
  PriorityTarget,
  SignatureChainHints,
  CollectedFileEntry,
} from './types.js';

export interface AnalyzeTargetParams {
  url: string;
  topN?: number;
  hookPreset?: HookPreset;
  autoInjectHooks?: boolean;
  waitAfterHookMs?: number;
  correlationWindowMs?: number;
  maxCorrelatedFlows?: number;
  maxFingerprints?: number;
  analysisCode: string;
  normalizedFiles: CollectedFileEntry[];
  candidateFiles: CollectedFileEntry[];
  hookRecords: Array<{hookId: string; records: Array<Record<string, unknown>>}>;
  injectedHooks: Array<{hookId: string; type: string; injected: boolean}>;
  understandResult: {qualityScore: number; securityRisks: Array<{severity: string}>};
  cryptoResult: {algorithms: Array<{name: string}>};
  deobfuscationResult?: {
    confidence: number;
    readabilityScore: number;
    transformations: number;
  };
  collectionResult?: {dependencies?: {nodes: unknown[]; edges: unknown[]}};
}

export async function analyzeTarget(
  params: AnalyzeTargetParams,
): Promise<AnalyzeTargetResult> {
  const startedAt = Date.now();
  const hookPreset = params.hookPreset ?? 'api-signature';
  const autoInjectHooks = params.autoInjectHooks ?? true;
  const correlationWindowMs = params.correlationWindowMs ?? 1500;
  const maxCorrelatedFlows = params.maxCorrelatedFlows ?? 20;
  const maxFingerprints = params.maxFingerprints ?? 12;

  const hookTimeline = buildHookTimeline(params.hookRecords);
  const urlActivity = hookTimeline.reduce<Record<string, number>>(
    (acc, item) => {
      if (item.url) {
        acc[item.url] = (acc[item.url] ?? 0) + 1;
      }
      return acc;
    },
    {},
  );
  const activeUrls = Object.entries(urlActivity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([url, count]) => ({url, count}));
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
  const signatureHints = extractSignatureChainHints(params.analysisCode);
  const priorityTargets = buildPriorityTargets({
    requestFingerprints,
    signatureHints,
    maxTargets: 10,
  });
  const actionPlan = buildActionPlan({
    target: params.url,
    topHookIds: params.injectedHooks,
    suspiciousFlows,
    priorityTargets,
    signatureHints,
  });
  const collectionDependencies: {nodes: unknown[]; edges: unknown[]} =
    params.collectionResult && typeof params.collectionResult === 'object'
      ? ((params.collectionResult as {dependencies?: {nodes: unknown[]; edges: unknown[]}}).dependencies ?? {nodes: [], edges: []})
      : {nodes: [], edges: []};

  const result = {
    target: params.url,
    durationMs: Date.now() - startedAt,
    collection: {
      totalCollected: params.normalizedFiles.length,
      selectedForAnalysis: params.candidateFiles.length,
      dependencies: collectionDependencies,
    },
    analysis: {
      qualityScore: params.understandResult.qualityScore,
      securityRiskCount: params.understandResult.securityRisks.length,
      cryptoAlgorithms: params.cryptoResult.algorithms.map(item => item.name),
    },
    deobfuscation: params.deobfuscationResult
      ? {
          confidence: params.deobfuscationResult.confidence,
          readabilityScore: params.deobfuscationResult.readabilityScore,
          transformations: params.deobfuscationResult.transformations,
        }
      : null,
    hooks: {
      preset: hookPreset,
      autoInjected: autoInjectHooks,
      hookIds: params.injectedHooks,
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
      params.cryptoResult.algorithms.length > 0
        ? 'Focus on crypto-related files from top-priority list.'
        : null,
      hookTimeline.length === 0
        ? 'Trigger page interactions and rerun get_hook_data / analyze_target.'
        : null,
      params.understandResult.securityRisks.length > 0
        ? 'Review high-severity security findings and verify call stacks.'
        : null,
    ].filter((item): item is string => Boolean(item)),
  };

  return {
    success: true,
    message: `分析完成，目标: ${params.url}`,
    tooltype: 'analyze_target',
    data: result,
  };
}