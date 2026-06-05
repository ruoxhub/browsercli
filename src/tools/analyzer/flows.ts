/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HookTimelineEntry, CorrelatedFlow} from './types.js';

interface FlowBucket {
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
}

function isInWindow(timestamp: number, bucketLastTimestamp: number, timeWindowMs: number): boolean {
  return timestamp - bucketLastTimestamp <= timeWindowMs;
}

function mergeIntoBucket(bucket: FlowBucket, item: HookTimelineEntry, eventName: string): void {
  bucket.lastTimestamp = item.timestamp;
  bucket.eventCount += 1;
  bucket.hookIds.add(item.hookId);
  bucket.events.add(eventName);
  if (typeof item.status === 'number') {
    bucket.statuses.add(item.status);
  }
  for (const indicator of item.signatureIndicators ?? []) {
    bucket.signatureIndicators.add(indicator);
  }
}

function createBucket(item: HookTimelineEntry, key: string, method: string, eventName: string): FlowBucket {
  return {
    key,
    url: item.url,
    method,
    firstTimestamp: item.timestamp,
    lastTimestamp: item.timestamp,
    eventCount: 1,
    hookIds: new Set([item.hookId]),
    events: new Set([eventName]),
    statuses: typeof item.status === 'number' ? new Set([item.status]) : new Set(),
    signatureIndicators: new Set(item.signatureIndicators ?? []),
  };
}

function bucketToFlow(bucket: FlowBucket): CorrelatedFlow {
  return {
    url: bucket.url,
    method: bucket.method,
    firstTimestamp: bucket.firstTimestamp,
    lastTimestamp: bucket.lastTimestamp,
    eventCount: bucket.eventCount,
    hookIds: Array.from(bucket.hookIds),
    events: Array.from(bucket.events),
    statuses: Array.from(bucket.statuses),
    signatureIndicators: Array.from(bucket.signatureIndicators),
  };
}

export function correlateNetworkFlows(
  timeline: HookTimelineEntry[],
  timeWindowMs: number,
  maxFlows: number,
): CorrelatedFlow[] {
  const buckets: FlowBucket[] = [];

  for (const item of timeline) {
    if (!item.url) {
      continue;
    }
    const method = item.method ?? (item.target === 'websocket' ? 'WS' : 'UNKNOWN');
    const key = `${item.url}::${method}`;
    const eventName = item.event ?? item.target;
    const existing = buckets.find(
      bucket => bucket.key === key && isInWindow(item.timestamp, bucket.lastTimestamp, timeWindowMs),
    );

    if (existing) {
      mergeIntoBucket(existing, item, eventName);
      continue;
    }

    buckets.push(createBucket(item, key, method, eventName));
  }

  return buckets
    .sort((a, b) => b.eventCount - a.eventCount || b.lastTimestamp - a.lastTimestamp)
    .slice(0, maxFlows)
    .map(bucketToFlow);
}
