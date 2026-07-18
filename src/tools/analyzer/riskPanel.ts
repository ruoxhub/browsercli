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

import type {RiskPanelResult, RiskPanelData} from './types.js';

const RISK_PANEL_TIMEOUT_MS = 10_000;
const DANGEROUS_ALGORITHMS = new Set(['md5', 'sha1', 'rc4', 'des']);
const HIGH_SEVERITY_WEIGHT = 20;
const CRYPTO_ISSUE_WEIGHT = 15;
const DANGEROUS_ALGORITHM_WEIGHT = 10;
const HOOK_SIGNAL_WEIGHT = 2;
const HOOK_SIGNAL_CAP = 10;
const HIGH_RISK_THRESHOLD = 70;
const MEDIUM_RISK_THRESHOLD = 40;

function emptyRiskPanelData(): RiskPanelData {
  return {
    score: 0,
    level: 'low',
    factors: {
      securityRisks: 0,
      highSeverityRisks: 0,
      cryptoAlgorithms: 0,
      cryptoIssues: 0,
      dangerousAlgorithms: [],
      hookSignals: 0,
    },
    recommendations: [],
  };
}

function getLevelForScore(score: number): 'high' | 'medium' | 'low' {
  if (score >= HIGH_RISK_THRESHOLD) return 'high';
  if (score >= MEDIUM_RISK_THRESHOLD) return 'medium';
  return 'low';
}

function countHookSignals(
  runtime: ReturnType<typeof getRuntime>,
  hookId: string | undefined,
): number {
  if (hookId) {
    return runtime.hookManager.getRecords(hookId).length;
  }
  return runtime.hookManager
    .getAllKnownHookIds()
    .reduce((sum, id) => sum + runtime.hookManager.getRecords(id).length, 0);
}

function buildRiskRecommendations(input: {
  highSeverityCount: number;
  dangerousAlgorithmCount: number;
  hookSignalCount: number;
}): string[] {
  const items: string[] = [];
  if (input.highSeverityCount > 0) {
    items.push('Prioritize high-severity security findings first.');
  }
  if (input.dangerousAlgorithmCount > 0) {
    items.push('Replace weak crypto algorithms (MD5/SHA1/RC4/DES).');
  }
  if (input.hookSignalCount > 0) {
    items.push(
      'Review hook records to confirm if suspicious paths are expected.',
    );
  }
  return items;
}

export const riskPanel = defineTool({
  name: 'risk_panel',
  description: '综合分析器、加密检测与 Hook 信号构建统一风险评分。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string().optional(),
    useAI: zod.boolean().optional(),
    includeHookSignals: zod.boolean().optional(),
    hookId: zod.string().optional(),
    topN: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getRuntime();
    if (!runtime?.analyzer?.understand || !runtime?.cryptoDetector?.detect) {
      response.setStructuredContent({
        success: false,
        message:
          'risk_panel requires analyzer.understand and cryptoDetector.detect runtime services',
        tooltype: 'riskPanel',
        data: emptyRiskPanelData(),
      });
      return;
    }

    let code = request.params.code;
    if (!code) {
      const top = runtime.collector.getTopPriorityFiles(
        request.params.topN ?? 5,
      );
      if (top.files.length === 0) {
        response.setStructuredContent({
          success: false,
          message:
            'No code provided and no collected files found. Run collect_code first.',
          tooltype: 'riskPanel',
          logFormat: 'json',
          data: emptyRiskPanelData(),
        });
        return;
      }
      code = top.files
        .map(file => `// ${file.url}\n${file.content}`)
        .join('\n\n');
    }

    const [understand, crypto] = await withOperationTimeout(
      Promise.all([
        runtime.analyzer.understand({
          code,
          focus: 'security',
        }),
        runtime.cryptoDetector.detect({code}),
      ]),
      'risk_panel 分析',
      RISK_PANEL_TIMEOUT_MS,
    );

    const securityRisks = Array.isArray(understand.securityRisks)
      ? understand.securityRisks
      : [];
    const highSeverityCount = securityRisks.filter(
      risk => risk.severity === 'critical' || risk.severity === 'high',
    ).length;

    const cryptoResult = crypto as {
      securityIssues?: unknown[];
      algorithms?: Array<{name?: string}>;
    };
    const cryptoIssues = Array.isArray(cryptoResult.securityIssues)
      ? cryptoResult.securityIssues
      : [];
    const algorithms = Array.isArray(cryptoResult.algorithms)
      ? cryptoResult.algorithms
      : [];
    const dangerousAlgorithms = algorithms.filter(algo =>
      DANGEROUS_ALGORITHMS.has(String(algo.name ?? '').toLowerCase()),
    );

    const hookSignalCount =
      request.params.includeHookSignals !== false
        ? countHookSignals(runtime, request.params.hookId)
        : 0;

    const rawScore =
      highSeverityCount * HIGH_SEVERITY_WEIGHT +
      cryptoIssues.length * CRYPTO_ISSUE_WEIGHT +
      dangerousAlgorithms.length * DANGEROUS_ALGORITHM_WEIGHT +
      Math.min(hookSignalCount, HOOK_SIGNAL_CAP) * HOOK_SIGNAL_WEIGHT;

    const score = Math.max(0, Math.min(100, rawScore));

    response.setStructuredContent<RiskPanelResult>({
      success: true,
      message: 'Risk panel analysis completed',
      tooltype: 'riskPanel',
      data: {
        score,
        level: getLevelForScore(score),
        factors: {
          securityRisks: securityRisks.length,
          highSeverityRisks: highSeverityCount,
          cryptoAlgorithms: algorithms.length,
          cryptoIssues: cryptoIssues.length,
          dangerousAlgorithms: dangerousAlgorithms.map(
            algo => algo.name ?? 'unknown',
          ),
          hookSignals: hookSignalCount,
        },
        recommendations: buildRiskRecommendations({
          highSeverityCount,
          dangerousAlgorithmCount: dangerousAlgorithms.length,
          hookSignalCount,
        }),
      },
    });
  },
});
