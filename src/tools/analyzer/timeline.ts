/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HookTimelineEntry} from './types.js';

const SIGNATURE_KEYWORDS = [
  'sign',
  'signature',
  'token',
  'auth',
  'x-sign',
  'hmac',
  'nonce',
] as const;

const SIGNATURE_INDICATOR_FIELDS = ['url', 'method', 'body', 'requestBody', 'data'] as const;

function readString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? (record[key] as string) : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === 'number' ? (record[key] as number) : undefined;
}

function findSignatureIndicators(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  const text = value.toLowerCase();
  const indicators = SIGNATURE_KEYWORDS.filter(keyword => text.includes(keyword));
  return [...new Set(indicators)];
}

function collectSignatureIndicators(record: Record<string, unknown>): string[] {
  const indicators: string[] = [];
  for (const field of SIGNATURE_INDICATOR_FIELDS) {
    indicators.push(...findSignatureIndicators(record[field]));
  }
  return indicators;
}

function toTimelineEntry(
  hookId: string,
  record: Record<string, unknown>,
): HookTimelineEntry {
  const method = readString(record, 'method');
  return {
    hookId,
    target: readString(record, 'target') ?? 'unknown',
    url: readString(record, 'url'),
    event: readString(record, 'event'),
    method: method ? method.toUpperCase() : undefined,
    status: readNumber(record, 'status'),
    signatureIndicators: collectSignatureIndicators(record),
    timestamp: readNumber(record, 'timestamp') ?? Date.now(),
  };
}

export function buildHookTimeline(
  hookRecords: Array<{hookId: string; records: Array<Record<string, unknown>>}>,
): HookTimelineEntry[] {
  const timeline = hookRecords.flatMap(entry =>
    entry.records.map(record => toTimelineEntry(entry.hookId, record)),
  );
  timeline.sort((a, b) => a.timestamp - b.timestamp);
  return timeline;
}
