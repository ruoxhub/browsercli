/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {evaluateInPageRuntime} from '../debugger/evaluateInPageRuntime.js';
import {inferTypeFromTarget} from './record-utils.js';

export const HOOK_STORE_KEY = '__hookStore';
export const DEFAULT_HOOK_STORE_MAX_RECORDS = 500;

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
  preserveEmpty?: boolean;
}

interface BrowserHookStoreRuntimeOptions {
  hookId: string;
  type: string;
  target: string;
  maxRecords?: number;
  showStack?: boolean;
  triggerDebugger?: boolean;
}

export function buildHookStoreRuntime(
  options: BrowserHookStoreRuntimeOptions,
): string {
  const runtime = {
    ...options,
    maxRecords:
      typeof options.maxRecords === 'number' && options.maxRecords > 0
        ? Math.floor(options.maxRecords)
        : DEFAULT_HOOK_STORE_MAX_RECORDS,
    showStack: options.showStack === true,
    triggerDebugger: options.triggerDebugger === true,
  };

  return [
    `  const __hookRuntime = ${JSON.stringify(runtime)};`,
    `  const __hookStoreKey = ${JSON.stringify(HOOK_STORE_KEY)};`,
    `  if (!window[__hookStoreKey] || typeof window[__hookStoreKey] !== 'object') {`,
    `    window[__hookStoreKey] = {};`,
    `  }`,
    `  const __hookStore = window[__hookStoreKey];`,
    `  if (!Array.isArray(__hookStore[__hookRuntime.hookId])) {`,
    `    __hookStore[__hookRuntime.hookId] = [];`,
    `  }`,
    `  function __captureHookStack() {`,
    `    const stack = new Error().stack;`,
    `    return typeof stack === 'string' ? stack.split('\\n').slice(2, 12).join('\\n') : undefined;`,
    `  }`,
    `  function __cloneHookValue(value) {`,
    `    if (value === null || value === undefined) return value;`,
    `    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;`,
    `    if (Array.isArray(value)) {`,
    `      return value.map(__cloneHookValue);`,
    `    }`,
    `    try {`,
    `      return JSON.parse(JSON.stringify(value));`,
    `    } catch (_error) {`,
    `      return String(value);`,
    `    }`,
    `  }`,
    `  function __pushHookRecord(record) {`,
    `    const entry = Object.assign({`,
    `      hookId: __hookRuntime.hookId,`,
    `      type: __hookRuntime.type,`,
    `      target: __hookRuntime.target,`,
    `      timestamp: Date.now(),`,
    `    }, record || {});`,
    `    if (__hookRuntime.showStack && entry.stack === undefined) {`,
    `      entry.stack = __captureHookStack();`,
    `    }`,
    `    const __records = __hookStore[__hookRuntime.hookId];`,
    `    if (__records.length >= __hookRuntime.maxRecords) __records.shift();`,
    `    __records.push(entry);`,
    `    if (__hookRuntime.triggerDebugger) debugger;`,
    `    return entry;`,
    `  }`,
    ``,
  ].join('\n');
}

export async function readHookStore(
  frame: Frame,
  hookId?: string,
): Promise<Record<string, unknown[]>> {
  const readViaFrameEvaluate = async () =>
    await frame.evaluate((id?: string) => {
      const hookStoreKey = '__hookStore';
      const rawStore = (window as typeof window & Record<string, unknown>)[
        hookStoreKey
      ];
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

  if (typeof (frame as Frame & {page?: () => unknown}).page !== 'function') {
    return readViaFrameEvaluate();
  }

  // 使用 CDP Runtime.evaluate（不带 contextId）从页面默认上下文读取
  // frame.evaluate() 在 Playwright 的隔离 utility world 中执行，
  // 无法读取页面主 world 的 window.__hookStore
  const hookIdJson = JSON.stringify(hookId ?? '');
  const expression = `(function() {
  var hookStoreKey = '__hookStore';
  var rawStore = window[hookStoreKey];
  var store = rawStore && typeof rawStore === 'object' ? rawStore : {};
  var normalize = function(value) { return Array.isArray(value) ? value : []; };
  var id = ${hookIdJson};
  if (typeof id === 'string' && id.length > 0) {
    var result = {};
    result[id] = normalize(store[id]);
    return result;
  }
  var all = {};
  var keys = Object.keys(store);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = store[key];
    if (Array.isArray(value)) {
      all[key] = value;
    }
  }
  return all;
})()`;

  try {
    return await evaluateInPageRuntime<Record<string, unknown[]>>(
      frame,
      expression,
    );
  } catch {
    // CDP Runtime.evaluate 不可用时，回退到 frame.evaluate
    return readViaFrameEvaluate();
  }
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
  const hooks: HookStoreSummaryItem[] = Object.entries(storeSnapshot)
    .map(([hookId, records]) => {
      const filteredRecords = filterHookRecords(records, filters);
      if (filteredRecords.length === 0 && filters?.preserveEmpty !== true) {
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

      const summaryItem: HookStoreSummaryItem = {
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
      return summaryItem;
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
      .filter(
        ([, records]) => records.length > 0 || filters?.preserveEmpty === true,
      ),
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
  return typeof target === 'string' ? inferTypeFromTarget(target) : undefined;
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
