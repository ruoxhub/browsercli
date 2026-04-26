/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

export interface HookStoreSummaryItem {
  hookId: string;
  type: string;
  total: number;
  lastEvent?: string;
  lastTarget?: string;
  lastTimestamp?: number;
  recentRecords: unknown[];
}

export interface HookStoreSummary {
  totalHooks: number;
  totalRecords: number;
  hooks: HookStoreSummaryItem[];
}

export interface HookStoreFilterParams {
  type?: string;
  event?: string;
  phase?: string;
}

export async function readHookStore(
  frame: Frame,
  hookId?: string,
): Promise<Record<string, unknown[]>> {
  return await frame.evaluate((id?: string) => {
    const rawStore = (window as typeof window & {__hookStore?: unknown})
      .__hookStore;
    const store =
      rawStore && typeof rawStore === 'object'
        ? (rawStore as Record<string, unknown>)
        : {};

    const normalize = (value: unknown) => (Array.isArray(value) ? value : []);

    if (typeof id === 'string' && id.length > 0) {
      return {[id]: normalize(store[id])};
    }

    const all: Record<string, unknown[]> = {};
    for (const [key, value] of Object.entries(store)) {
      if (Array.isArray(value)) {
        all[key] = value;
      }
    }
    return all;
  }, hookId);
}

export function limitRecords(
  records: unknown[],
  maxRecords?: number,
): unknown[] {
  if (
    typeof maxRecords !== 'number' ||
    !Number.isFinite(maxRecords) ||
    maxRecords <= 0
  ) {
    return records;
  }

  return records.slice(-Math.floor(maxRecords));
}

export function summarizeHookStore(
  storeSnapshot: Record<string, unknown[]>,
  filters?: HookStoreFilterParams,
  maxRecords?: number,
): HookStoreSummary {
  const hooks = Object.entries(storeSnapshot)
    .map(([hookId, records]) => {
      const filteredRecords = filterHookRecords(records, filters);
      if (filteredRecords.length === 0) {
        return null;
      }

      const trimmedRecords = limitRecords(filteredRecords, maxRecords);
      const lastRecord =
        trimmedRecords.at(-1) ??
        (filteredRecords.length > 0
          ? filteredRecords[filteredRecords.length - 1]
          : undefined);
      const typedLastRecord =
        lastRecord && typeof lastRecord === 'object'
          ? (lastRecord as Record<string, unknown>)
          : undefined;

      return {
        hookId,
        type: inferHookType(hookId, filteredRecords),
        total: filteredRecords.length,
        lastEvent:
          typeof typedLastRecord?.event === 'string'
            ? typedLastRecord.event
            : undefined,
        lastTarget:
          typeof typedLastRecord?.target === 'string'
            ? typedLastRecord.target
            : undefined,
        lastTimestamp:
          typeof typedLastRecord?.timestamp === 'number'
            ? typedLastRecord.timestamp
            : undefined,
        recentRecords: trimmedRecords,
      };
    })
    .filter((item): item is HookStoreSummaryItem => item !== null);

  hooks.sort((left, right) => right.total - left.total);

  return {
    totalHooks: hooks.length,
    totalRecords: hooks.reduce((sum, item) => sum + item.total, 0),
    hooks,
  };
}

export function filterHookStore(
  storeSnapshot: Record<string, unknown[]>,
  filters?: HookStoreFilterParams,
  maxRecords?: number,
): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(storeSnapshot)
      .map(([hookId, records]) => [
        hookId,
        limitRecords(filterHookRecords(records, filters), maxRecords),
      ])
      .filter(([, records]) => records.length > 0),
  );
}

function filterHookRecords(
  records: unknown[],
  filters?: HookStoreFilterParams,
): unknown[] {
  if (!filters || (!filters.type && !filters.event && !filters.phase)) {
    return records;
  }

  return records.filter(record => {
    if (!record || typeof record !== 'object') {
      return false;
    }

    const typedRecord = record as Record<string, unknown>;
    const recordType =
      typeof typedRecord.type === 'string'
        ? typedRecord.type
        : inferTypeFromRecordTarget(typedRecord.target);

    if (filters.type && recordType !== filters.type) {
      return false;
    }

    if (filters.event && typedRecord.event !== filters.event) {
      return false;
    }

    if (filters.phase && typedRecord.phase !== filters.phase) {
      return false;
    }

    return true;
  });
}

function inferTypeFromRecordTarget(target: unknown): string | undefined {
  if (typeof target !== 'string') {
    return undefined;
  }

  if (target.includes('fetch')) return 'fetch';
  if (target.includes('XMLHttpRequest')) return 'xhr';
  if (target.includes('cookie')) return 'cookie';
  if (target.includes('WebSocket')) return 'websocket';
  if (target.includes('setTimeout') || target.includes('setInterval')) {
    return 'timer';
  }
  if (target.includes('window.eval') || target.includes('window.Function')) {
    return 'eval';
  }
  if (target.includes('JSEncrypt')) return 'jsencrypt';
  if (
    target.includes('sm2') ||
    target.includes('sm3') ||
    target.includes('sm4')
  ) {
    return 'smcrypto';
  }
  if (
    target.includes('CryptoJS') ||
    target.includes('Function.prototype.apply')
  ) {
    return 'cryptojs';
  }
  return undefined;
}

function inferHookType(hookId: string, records: unknown[]): string {
  for (const record of records) {
    if (record && typeof record === 'object') {
      const typedRecord = record as Record<string, unknown>;
      if (typeof typedRecord.type === 'string' && typedRecord.type.length > 0) {
        return typedRecord.type;
      }

      const inferredType = inferTypeFromRecordTarget(typedRecord.target);
      if (inferredType) {
        return inferredType;
      }
    }
  }

  if (hookId.includes('fetch')) return 'fetch';
  if (hookId.includes('xhr')) return 'xhr';
  if (hookId.includes('cookie')) return 'cookie';
  if (hookId.includes('websocket') || hookId.includes('ws')) return 'websocket';
  if (hookId.includes('timer')) return 'timer';
  if (hookId.includes('eval')) return 'eval';
  if (hookId.includes('cryptojs')) return 'cryptojs';
  if (hookId.includes('jsencrypt')) return 'jsencrypt';
  if (hookId.includes('smcrypto')) return 'smcrypto';
  if (hookId.includes('json')) return 'json';
  if (hookId.includes('storage')) return 'storage';
  return 'unknown';
}
