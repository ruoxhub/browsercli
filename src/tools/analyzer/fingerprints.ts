/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RequestFingerprint,
  PriorityTarget,
  SignatureChainHints,
} from './types.js';

const URL_NUMBER_SEGMENT = /\/\d{2,}(?=\/|$)/g;
const URL_HEX_SEGMENT = /\/[a-f0-9]{8,}(?=\/|$)/gi;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'WS']);
const MAX_EVENTS_FOR_SCORE = 10;
const MAX_INDICATORS_FOR_SCORE = 5;
const SCORE_PER_INDICATOR = 3;
const ERROR_STATUS_BONUS = 2;
const PRIORITY_INDICATOR_WEIGHT = 2;
const PRIORITY_WRITE_BONUS = 3;
const PRIORITY_FUNCTION_BASE = 6;
const PRIORITY_MAX_PARAMS = 4;
const MAX_FUNCTION_TARGETS = 5;
const MAX_SAMPLE_URLS = 3;

export function buildUrlPattern(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const normalizedPath = parsed.pathname
      .replace(URL_NUMBER_SEGMENT, '/:num')
      .replace(URL_HEX_SEGMENT, '/:hex');
    const queryKeys = Array.from(parsed.searchParams.keys()).sort();
    const queryPattern = queryKeys.length > 0 ? `?${queryKeys.join('&')}` : '';
    return `${parsed.origin}${normalizedPath || '/'}${queryPattern}`;
  } catch {
    return rawUrl
      .split('?')[0]
      .replace(URL_NUMBER_SEGMENT, '/:num')
      .replace(URL_HEX_SEGMENT, '/:hex');
  }
}

interface FingerprintBucket {
  urlPattern: string;
  methods: Set<string>;
  flowCount: number;
  totalEvents: number;
  signatureIndicators: Set<string>;
  suspiciousScore: number;
  sampleUrls: Set<string>;
}

function scoreFlow(flow: {
  eventCount: number;
  signatureIndicators: string[];
  statuses: number[];
}): number {
  return (
    Math.min(flow.eventCount, MAX_EVENTS_FOR_SCORE) +
    Math.min(flow.signatureIndicators.length, MAX_INDICATORS_FOR_SCORE) *
      SCORE_PER_INDICATOR +
    (flow.statuses.some(status => status >= 400) ? ERROR_STATUS_BONUS : 0)
  );
}

function mergeFingerprintBucket(
  bucket: FingerprintBucket,
  flow: {
    url: string;
    method: string;
    eventCount: number;
    signatureIndicators: string[];
    statuses: number[];
  },
  flowScore: number,
): void {
  bucket.methods.add(flow.method);
  bucket.flowCount += 1;
  bucket.totalEvents += flow.eventCount;
  bucket.suspiciousScore += flowScore;
  for (const indicator of flow.signatureIndicators) {
    bucket.signatureIndicators.add(indicator);
  }
  bucket.sampleUrls.add(flow.url);
}

function bucketToFingerprint(bucket: FingerprintBucket): RequestFingerprint {
  const methods = Array.from(bucket.methods).sort();
  const signatureIndicators = Array.from(bucket.signatureIndicators).sort();
  return {
    fingerprint: `${methods.join('+')} ${bucket.urlPattern}`.trim(),
    urlPattern: bucket.urlPattern,
    methods,
    flowCount: bucket.flowCount,
    totalEvents: bucket.totalEvents,
    signatureIndicators,
    signatureIndicatorCount: signatureIndicators.length,
    suspiciousScore: bucket.suspiciousScore,
    sampleUrls: Array.from(bucket.sampleUrls).slice(0, MAX_SAMPLE_URLS),
  };
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
  const buckets = new Map<string, FingerprintBucket>();

  for (const flow of flows) {
    const urlPattern = buildUrlPattern(flow.url);
    const flowScore = scoreFlow(flow);
    const existing = buckets.get(urlPattern);
    if (existing) {
      mergeFingerprintBucket(existing, flow, flowScore);
      continue;
    }
    buckets.set(urlPattern, {
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
    .map(bucketToFingerprint);
}

function buildNetworkTarget(
  item: {
    urlPattern: string;
    methods: string[];
    suspiciousScore: number;
    signatureIndicatorCount: number;
  },
  signatureHints: SignatureChainHints,
): PriorityTarget {
  const isWritePath = item.methods.some(method => WRITE_METHODS.has(method));
  const score =
    item.suspiciousScore +
    item.signatureIndicatorCount * PRIORITY_INDICATOR_WEIGHT +
    (isWritePath ? PRIORITY_WRITE_BONUS : 0) +
    (signatureHints.requestSinks.length > 0 ? 1 : 0);
  const reasons: string[] = [];
  if (item.signatureIndicatorCount > 0) {
    reasons.push(`signature indicators: ${item.signatureIndicatorCount}`);
  }
  if (isWritePath) {
    reasons.push(`write-like methods: ${item.methods.join(', ')}`);
  }
  return {
    target: item.urlPattern,
    type: 'network',
    priorityScore: score,
    reasons,
  };
}

function buildFunctionTarget(
  name: string,
  signatureHints: SignatureChainHints,
): PriorityTarget {
  const reasons: string[] = ['name matches signing/encryption keywords'];
  if (signatureHints.signatureParams.length > 0) {
    reasons.push(
      `related params: ${signatureHints.signatureParams.slice(0, PRIORITY_MAX_PARAMS).join(', ')}`,
    );
  }
  return {
    target: name,
    type: 'function',
    priorityScore:
      PRIORITY_FUNCTION_BASE +
      Math.min(signatureHints.signatureParams.length, PRIORITY_MAX_PARAMS),
    reasons,
  };
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
  const networkTargets = input.requestFingerprints.map(item =>
    buildNetworkTarget(item, input.signatureHints),
  );
  const functionTargets = input.signatureHints.candidateFunctions
    .slice(0, MAX_FUNCTION_TARGETS)
    .map(name => buildFunctionTarget(name, input.signatureHints));

  return [...networkTargets, ...functionTargets]
    .sort(
      (a, b) =>
        b.priorityScore - a.priorityScore || a.target.localeCompare(b.target),
    )
    .slice(0, input.maxTargets);
}
