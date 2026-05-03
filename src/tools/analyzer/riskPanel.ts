/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {withOperationTimeout} from '../shared/browserRuntime.js';
import type {RiskPanelResult} from './types.js';

export async function riskPanel(
  params: {
    code?: string;
    topN?: number;
    includeHookSignals?: boolean;
    hookId?: string;
  },
): Promise<RiskPanelResult> {
  const runtime = getRuntime();
  if (!runtime?.analyzer?.understand || !runtime?.cryptoDetector?.detect) {
    return {
      success: false,
      message: 'risk_panel requires analyzer.understand and cryptoDetector.detect runtime services',
      tooltype: 'riskPanel',
      data: {
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
      },
    };
  }

  let code = params.code;
  if (!code) {
    const top = runtime.collector.getTopPriorityFiles(params.topN ?? 5);
    if (top.files.length === 0) {
      return {
        success: false,
        message: 'No code provided and no collected files found. Run collect_code first.',
        tooltype: 'riskPanel',
        data: {
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
        },
      };
    }
    code = top.files.map(file => `// ${file.url}\n${file.content}`).join('\n\n');
  }

  const [understand, crypto] = await withOperationTimeout(
    Promise.all([
      runtime.analyzer.understand({
        code: code ?? '',
        focus: 'security',
      }),
      runtime.cryptoDetector.detect({code: code ?? ''}),
    ]),
    'risk_panel 分析',
    10000,
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
    ['md5', 'sha1', 'rc4', 'des'].includes(
      String(algo.name ?? '').toLowerCase(),
    ),
  );

  let hookSignalCount = 0;
  if (params.includeHookSignals !== false) {
    if (params.hookId) {
      hookSignalCount = runtime.hookManager.getRecords(params.hookId).length;
    } else {
      hookSignalCount = runtime.hookManager
        .getAllKnownHookIds()
        .reduce((sum, hookId) => sum + runtime.hookManager.getRecords(hookId).length, 0);
    }
  }

  const rawScore =
    highSeverityCount * 20 +
    cryptoIssues.length * 15 +
    dangerousAlgorithms.length * 10 +
    Math.min(hookSignalCount, 10) * 2;

  const score = Math.max(0, Math.min(100, rawScore));
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

  const recommendations = [
    highSeverityCount > 0
      ? 'Prioritize high-severity security findings first.'
      : null,
    dangerousAlgorithms.length > 0
      ? 'Replace weak crypto algorithms (MD5/SHA1/RC4/DES).'
      : null,
    hookSignalCount > 0
      ? 'Review hook records to confirm if suspicious paths are expected.'
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    success: true,
    message: 'Risk panel analysis completed',
    tooltype: 'riskPanel',
    data: {
      score,
      level,
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
      recommendations,
    },
  };
}