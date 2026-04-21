/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HookTimelineEntry, CorrelatedFlow} from './types.js';

export function correlateNetworkFlows(
  timeline: HookTimelineEntry[],
  timeWindowMs: number,
  maxFlows: number,
): CorrelatedFlow[] {
  const buckets: Array<{
    key: string;
    url: string;
    method: string;
    firstTimestamp: number;
    lastTimestamp: number;
    eventCount: number;
    hookIds: Set<string>;
    events: Set<string>;
    statuses: Set<number>;
    signatureIndicators: Set<string>;
  }> = [];

  for (const item of timeline) {
    if (!item.url) {
      continue;
    }
    const method =
      item.method ?? (item.target === 'websocket' ? 'WS' : 'UNKNOWN');
    const key = `${item.url}::${method}`;
    const eventName = item.event ?? item.target;
    const existing = buckets.find(
      bucket =>
        bucket.key === key &&
        item.timestamp - bucket.lastTimestamp <= timeWindowMs,
    );

    if (existing) {
      existing.lastTimestamp = item.timestamp;
      existing.eventCount += 1;
      existing.hookIds.add(item.hookId);
      existing.events.add(eventName);
      if (typeof item.status === 'number') {
        existing.statuses.add(item.status);
      }
      for (const indicator of item.signatureIndicators ?? []) {
        existing.signatureIndicators.add(indicator);
      }
      continue;
    }

    buckets.push({
      key,
      url: item.url,
      method,
      firstTimestamp: item.timestamp,
      lastTimestamp: item.timestamp,
      eventCount: 1,
      hookIds: new Set([item.hookId]),
      events: new Set([eventName]),
      statuses:
        typeof item.status === 'number' ? new Set([item.status]) : new Set(),
      signatureIndicators: new Set(item.signatureIndicators ?? []),
    });
  }

  return buckets
    .sort(
      (a, b) =>
        b.eventCount - a.eventCount || b.lastTimestamp - a.lastTimestamp,
    )
    .slice(0, maxFlows)
    .map(bucket => ({
      url: bucket.url,
      method: bucket.method,
      firstTimestamp: bucket.firstTimestamp,
      lastTimestamp: bucket.lastTimestamp,
      eventCount: bucket.eventCount,
      hookIds: Array.from(bucket.hookIds),
      events: Array.from(bucket.events),
      statuses: Array.from(bucket.statuses),
      signatureIndicators: Array.from(bucket.signatureIndicators),
    }));
}