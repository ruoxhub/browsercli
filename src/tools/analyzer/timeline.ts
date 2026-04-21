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

function findSignatureIndicators(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  const text = value.toLowerCase();
  const indicators = SIGNATURE_KEYWORDS.filter(keyword =>
    text.includes(keyword),
  );
  return [...new Set(indicators)];
}

export function buildHookTimeline(
  hookRecords: Array<{hookId: string; records: Array<Record<string, unknown>>}>,
): HookTimelineEntry[] {
  const timeline = hookRecords.flatMap(entry =>
    entry.records.map(record => ({
      hookId: entry.hookId,
      target: typeof record.target === 'string' ? record.target : 'unknown',
      url: typeof record.url === 'string' ? record.url : undefined,
      event: typeof record.event === 'string' ? record.event : undefined,
      method:
        typeof record.method === 'string'
          ? record.method.toUpperCase()
          : undefined,
      status: typeof record.status === 'number' ? record.status : undefined,
      signatureIndicators: [
        ...findSignatureIndicators(record.url),
        ...findSignatureIndicators(record.method),
        ...findSignatureIndicators(record.body),
        ...findSignatureIndicators(record.requestBody),
        ...findSignatureIndicators(record.data),
      ],
      timestamp:
        typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
    })),
  );
  timeline.sort((a, b) => a.timestamp - b.timestamp);
  return timeline;
}