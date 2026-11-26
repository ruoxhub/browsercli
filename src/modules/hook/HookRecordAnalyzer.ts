/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * HookRecordAnalyzer — Hook 采集记录归一化、过滤、摘要、请求绑定与环境需求推断
 * （从 tools/hook.ts 下沉至 L1 modules/hook）。
 */

import type {Frame} from '../../third_party/index.js';
import {evaluateInPageRuntime} from '../debugger/evaluateInPageRuntime.js';

// ─── record-utils.ts ─────────────────────────────────────

export interface NormalizedHookRecord {
  hookId?: string;
  type?: string;
  target: string;
  event: string;
  phase?: string;
  method: string;
  url: string;
  status?: number;
  bodySnippet: string;
  timestamp?: number;
}

export interface HookRecordSummaryEntry extends NormalizedHookRecord {
  count: number;
}

export interface HookRecordSummaryResult {
  total: number;
  unique: number;
  dropped: number;
  records: HookRecordSummaryEntry[];
}

export interface RequestBinding {
  hookId?: string;
  type?: string;
  event: string;
  method: string;
  url: string;
  status?: number;
}

export function toHookRecordArray(
  data: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && !Array.isArray(item),
  );
}

export function normalizeHookRecord(
  record: Record<string, unknown>,
): NormalizedHookRecord {
  const bodySource = buildBodySnippet(record) ?? '';

  return {
    hookId: stringOrUndefined(record.hookId),
    type:
      stringOrUndefined(record.type) ??
      inferTypeFromTarget(stringOrUndefined(record.target)),
    target: stringOrUndefined(record.target) ?? 'unknown',
    event: stringOrUndefined(record.event) ?? '',
    phase: stringOrUndefined(record.phase),
    method: normalizeMethod(record.method),
    url:
      stringOrUndefined(record.url) ??
      stringOrUndefined(record.requestUrl) ??
      '',
    status: numberOrUndefined(record.status),
    bodySnippet: bodySource.slice(0, 200),
    timestamp: numberOrUndefined(record.timestamp),
  };
}

export function summarizeHookRecords(
  records: NormalizedHookRecord[],
  limit = 20,
): HookRecordSummaryResult {
  if (records.length === 0) {
    return {total: 0, unique: 0, dropped: 0, records: []};
  }

  const buckets = new Map<string, HookRecordSummaryEntry>();
  for (const record of records) {
    const key = [
      record.hookId ?? '',
      record.type ?? '',
      record.target,
      record.event,
      record.phase ?? '',
      record.method,
      record.url,
      record.status ?? '',
      record.bodySnippet,
    ].join('||');

    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    buckets.set(key, {...record, count: 1});
  }

  const uniqueRecords = Array.from(buckets.values()).sort(
    (left, right) =>
      right.count - left.count ||
      (right.timestamp ?? 0) - (left.timestamp ?? 0),
  );
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : uniqueRecords.length;

  return {
    total: records.length,
    unique: uniqueRecords.length,
    dropped: Math.max(uniqueRecords.length - normalizedLimit, 0),
    records: uniqueRecords.slice(0, normalizedLimit),
  };
}

export function inferCandidateEnvNeeds(
  records: NormalizedHookRecord[],
): string[] {
  const needs = new Set<string>();

  for (const record of records) {
    const haystack = `${record.url} ${record.bodySnippet}`.toLowerCase();

    if (record.target.includes('fetch') || haystack.includes('http')) {
      needs.add('fetch');
      needs.add('location');
    }
    if (haystack.includes('cookie') || haystack.includes('session_id')) {
      needs.add('cookie');
    }
    if (
      haystack.includes('token') ||
      haystack.includes('storage') ||
      haystack.includes('localstorage') ||
      haystack.includes('sessionstorage')
    ) {
      needs.add('storage');
      if (haystack.includes('token')) {
        needs.add('cookie');
      }
    }
    if (
      haystack.includes('timestamp') ||
      haystack.includes('nonce') ||
      haystack.includes('date')
    ) {
      needs.add('Date');
    }
  }

  return Array.from(needs).sort();
}

export function buildRequestBindings(
  records: NormalizedHookRecord[],
): RequestBinding[] {
  const urlRecords = records.filter(record => record.url.length > 0);
  const preferredRecords = urlRecords.filter(record =>
    isPreferredRequestEvent(record.event),
  );
  const sourceRecords =
    preferredRecords.length > 0 ? preferredRecords : urlRecords;
  const grouped = new Map<string, RequestBinding>();

  for (const record of sourceRecords) {
    const key = [
      record.hookId ?? '',
      record.type ?? '',
      record.method || 'UNKNOWN',
      record.url,
    ].join('||');

    const existing = grouped.get(key);
    const candidate: RequestBinding = {
      hookId: record.hookId,
      type: record.type,
      event: record.event,
      method: record.method || 'UNKNOWN',
      url: record.url,
      status: findStatusForBinding(records, record),
    };

    if (!existing) {
      grouped.set(key, candidate);
      continue;
    }

    if (compareRequestBindingPriority(candidate, existing) < 0) {
      grouped.set(key, candidate);
    }
  }

  return Array.from(grouped.values()).slice(0, 10);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

function normalizeMethod(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

export function inferTypeFromTarget(target?: string): string | undefined {
  if (!target) return undefined;
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

function buildBodySnippet(record: Record<string, unknown>): string | undefined {
  const directString = firstString(
    record.body,
    record.requestBody,
    record.data,
    record.result,
    record.response,
    record.error,
    record.cookie,
    record.plaintext,
    record.ciphertext,
    record.input,
    record.hash,
    record.code,
    record.fnSnippet,
    record.key,
    record.publicKey,
    record.privateKey,
  );

  if (directString) {
    return directString;
  }

  const fragments: string[] = [];
  appendFragment(fragments, 'algorithm', record.algorithm);
  appendFragment(fragments, 'mode', record.mode);
  appendFragment(fragments, 'padding', record.padding);
  appendFragment(fragments, 'statusText', record.statusText);
  appendFragment(fragments, 'method', record.method);
  appendFragment(fragments, 'url', record.url ?? record.requestUrl);
  appendFragment(fragments, 'event', record.event);
  appendFragment(fragments, 'phase', record.phase);

  return fragments.length > 0 ? fragments.join(' ') : undefined;
}

function appendFragment(
  fragments: string[],
  key: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value.length > 0) {
    fragments.push(`${key}=${value}`);
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    fragments.push(`${key}=${value}`);
  }
}

function isPreferredRequestEvent(event: string): boolean {
  return ['request', 'open', 'send', 'call'].includes(event);
}

function findStatusForBinding(
  records: NormalizedHookRecord[],
  current: NormalizedHookRecord,
): number | undefined {
  const method = current.method || 'UNKNOWN';

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (
      (record.hookId ?? '') === (current.hookId ?? '') &&
      (record.type ?? '') === (current.type ?? '') &&
      (record.method || 'UNKNOWN') === method &&
      record.url === current.url &&
      typeof record.status === 'number'
    ) {
      return record.status;
    }
  }

  return current.status;
}

function compareRequestBindingPriority(
  left: RequestBinding,
  right: RequestBinding,
): number {
  return (
    requestEventPriority(left.event) - requestEventPriority(right.event) ||
    String(right.hookId ?? '').localeCompare(String(left.hookId ?? ''))
  );
}

function requestEventPriority(event: string): number {
  switch (event) {
    case 'request':
      return 0;
    case 'open':
      return 1;
    case 'send':
      return 2;
    case 'call':
      return 3;
    case 'response':
      return 4;
    case 'error':
      return 5;
    default:
      return 10;
  }
}

// ─── store-utils.ts ──────────────────────────────────────

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

/**
 * 读取浏览器端活跃 PageHook 注册表 window.__mcp_hooks__。
 *
 * 与 __hookStore（仅存记录）不同，__mcp_hooks__ 保存的是活跃 PageHook 的
 * 目标标识与还原句柄（target / restore，兼容旧 obj / methodName / original），
 * 即使某个 Hook 尚无任何调用记录也应出现在 list_created_hooks 中。
 */
export async function readMcpHookRegistry(
  frame: Frame,
): Promise<Array<{id: string; target: string}>> {
  const expression = `(function() {
  var reg = window.__mcp_hooks__;
  if (!reg || typeof reg !== 'object') return [];
  var out = [];
  var keys = Object.keys(reg);
  for (var i = 0; i < keys.length; i++) {
    var id = keys[i];
    var hook = reg[id];
    var target = id;
    try {
      if (hook && typeof hook.target === 'string' && hook.target) {
        target = hook.target;
      } else if (hook && hook.obj && hook.methodName) {
        var ctorName = (hook.obj.constructor && hook.obj.constructor.name) || 'window';
        target = ctorName + '.' + hook.methodName;
      }
    } catch (e) {}
    out.push({ id: id, target: target });
  }
  return out;
})()`;

  try {
    const result = await evaluateInPageRuntime<
      Array<{id: string; target: string}>
    >(frame, expression);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
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

