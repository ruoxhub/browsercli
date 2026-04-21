/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CorrelatedFlow, RequestFingerprint, PriorityTarget, SignatureChainHints} from './types.js';

export function buildUrlPattern(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const normalizedPath = parsed.pathname
      .replace(/\/\d{2,}(?=\/|$)/g, '/:num')
      .replace(/\/[a-f0-9]{8,}(?=\/|$)/gi, '/:hex');
    const queryKeys = Array.from(parsed.searchParams.keys()).sort();
    const queryPattern = queryKeys.length > 0 ? `?${queryKeys.join('&')}` : '';
    return `${parsed.origin}${normalizedPath || '/'}${queryPattern}`;
  } catch {
    return rawUrl
      .split('?')[0]
      .replace(/\/\d{2,}(?=\/|$)/g, '/:num')
      .replace(/\/[a-f0-9]{8,}(?=\/|$)/gi, '/:hex');
  }
}

export function buildRequestFingerprints(
  flows: Array<{
    url: string;
    method: string;
    eventCount: number;
    statuses: number[];
    signatureIndicators: string[];
  }>,
  maxFingerprints: number,
): RequestFingerprint[] {
  const buckets = new Map<
    string,
    {
      urlPattern: string;
      methods: Set<string>;
      flowCount: number;
      totalEvents: number;
      signatureIndicators: Set<string>;
      suspiciousScore: number;
      sampleUrls: Set<string>;
    }
  >();

  for (const flow of flows) {
    const urlPattern = buildUrlPattern(flow.url);
    const key = urlPattern;
    const existing = buckets.get(key);
    const flowScore =
      Math.min(flow.eventCount, 10) +
      Math.min(flow.signatureIndicators.length, 5) * 3 +
      (flow.statuses.some(status => status >= 400) ? 2 : 0);

    if (existing) {
      existing.methods.add(flow.method);
      existing.flowCount += 1;
      existing.totalEvents += flow.eventCount;
      existing.suspiciousScore += flowScore;
      for (const indicator of flow.signatureIndicators) {
        existing.signatureIndicators.add(indicator);
      }
      existing.sampleUrls.add(flow.url);
      continue;
    }

    buckets.set(key, {
      urlPattern,
      methods: new Set([flow.method]),
      flowCount: 1,
      totalEvents: flow.eventCount,
      signatureIndicators: new Set(flow.signatureIndicators),
      suspiciousScore: flowScore,
      sampleUrls: new Set([flow.url]),
    });
  }

  return Array.from(buckets.values())
    .sort(
      (a, b) =>
        b.suspiciousScore - a.suspiciousScore || b.totalEvents - a.totalEvents,
    )
    .slice(0, maxFingerprints)
    .map(bucket => {
      const methods = Array.from(bucket.methods).sort();
      const signatureIndicators = Array.from(bucket.signatureIndicators).sort();
      const fingerprint = `${methods.join('+')} ${bucket.urlPattern}`.trim();
      return {
        fingerprint,
        urlPattern: bucket.urlPattern,
        methods,
        flowCount: bucket.flowCount,
        totalEvents: bucket.totalEvents,
        signatureIndicators,
        signatureIndicatorCount: signatureIndicators.length,
        suspiciousScore: bucket.suspiciousScore,
        sampleUrls: Array.from(bucket.sampleUrls).slice(0, 3),
      };
    });
}

export function buildPriorityTargets(input: {
  requestFingerprints: Array<{
    urlPattern: string;
    methods: string[];
    suspiciousScore: number;
    signatureIndicatorCount: number;
  }>;
  signatureHints: SignatureChainHints;
  maxTargets: number;
}): PriorityTarget[] {
  const networkTargets = input.requestFingerprints.map(item => {
    const isWritePath = item.methods.some(method =>
      ['POST', 'PUT', 'PATCH', 'DELETE', 'WS'].includes(method),
    );
    const score =
      item.suspiciousScore +
      item.signatureIndicatorCount * 2 +
      (isWritePath ? 3 : 0) +
      (input.signatureHints.requestSinks.length > 0 ? 1 : 0);
    return {
      target: item.urlPattern,
      type: 'network' as const,
      priorityScore: score,
      reasons: [
        item.signatureIndicatorCount > 0
          ? `signature indicators: ${item.signatureIndicatorCount}`
          : null,
        isWritePath ? `write-like methods: ${item.methods.join(', ')}` : null,
      ].filter((value): value is string => Boolean(value)),
    };
  });

  const functionTargets = input.signatureHints.candidateFunctions
    .slice(0, 5)
    .map(name => ({
      target: name,
      type: 'function' as const,
      priorityScore:
        6 + Math.min(input.signatureHints.signatureParams.length, 4),
      reasons: [
        'name matches signing/encryption keywords',
        input.signatureHints.signatureParams.length > 0
          ? `related params: ${input.signatureHints.signatureParams.slice(0, 4).join(', ')}`
          : null,
      ].filter((value): value is string => Boolean(value)),
    }));

  return [...networkTargets, ...functionTargets]
    .sort(
      (a, b) =>
        b.priorityScore - a.priorityScore || a.target.localeCompare(b.target),
    )
    .slice(0, input.maxTargets);
}