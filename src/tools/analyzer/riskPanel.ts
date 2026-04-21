/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AnalyzerRuntimeServices, RiskPanelResult} from './types.js';
import type {UnderstandCodeOptions} from '../../types/index.js';

export async function riskPanel(
  runtime: AnalyzerRuntimeServices,
  params: {
    code?: string;
    topN?: number;
  },
): Promise<RiskPanelResult> {
  const [understand, crypto] = await Promise.all([
    runtime.analyzer.understand({
      code: params.code ?? '',
      focus: 'security',
    }),
    runtime.cryptoDetector.detect({code: params.code ?? ''}),
  ]);

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

  const rawScore =
    highSeverityCount * 20 +
    cryptoIssues.length * 15 +
    dangerousAlgorithms.length * 10;

  const score = Math.max(0, Math.min(100, rawScore));
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

  const recommendations = [
    highSeverityCount > 0
      ? 'Prioritize high-severity security findings first.'
      : null,
    dangerousAlgorithms.length > 0
      ? 'Replace weak crypto algorithms (MD5/SHA1/RC4/DES).'
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
        hookSignals: 0,
      },
      recommendations,
    },
  };
}