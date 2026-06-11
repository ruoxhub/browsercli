/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
