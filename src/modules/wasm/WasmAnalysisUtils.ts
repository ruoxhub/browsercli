/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  WasmBodyKind,
  WasmBodyPathAnalysis,
  WasmBodySegmentHint,
  WasmDataSegmentSummary,
  WasmExportEntry,
  WasmExternalKind,
  WasmHeaderEntry,
  WasmImportEntry,
  WasmKeyValuePreview,
  WasmMemoryInfo,
  WasmRuntimeEvent,
  WasmSectionSummary,
  WasmStringCategory,
  WasmStringSlot,
  WasmValueType,
} from './WasmTypes.js';

// ---------------------------------------------------------------------------
// Binary parsing
// ---------------------------------------------------------------------------

export interface WasmLimits {
  min: number;
  max?: number;
  shared?: boolean;
}

export interface ParsedTypeEntry {
  params: WasmValueType[];
  results: WasmValueType[];
}

export interface ParsedModule {
  sections: WasmSectionSummary[];
  imports: WasmImportEntry[];
  exports: WasmExportEntry[];
  memories: WasmMemoryInfo[];
  typeCount: number;
  functionCount: number;
  importFunctionCount: number;
  exportFunctionCount: number;
  tableCount: number;
  globalCount: number;
  dataSegmentCount: number;
  codeBodyCount: number;
  dataSegments: WasmDataSegmentSummary[];
  stringSlots: WasmStringSlot[];
  headerCandidates: WasmStringSlot[];
  keyMaterialCandidates: WasmStringSlot[];
  startFunctionIndex?: number;
}

export class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error('Unexpected end of Wasm payload');
    }
    return this.bytes[this.offset++]!;
  }

  readBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error('Unexpected end of Wasm payload');
    }
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  readVarUint32(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readByte();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result >>> 0;
      }
      shift += 7;
      if (shift > 35) {
        throw new Error('Invalid LEB128 integer');
      }
    }
  }

  readUtf8String(): string {
    const length = this.readVarUint32();
    return new TextDecoder().decode(this.readBytes(length));
  }

  skip(length: number): void {
    this.readBytes(length);
  }
}

export function decodeValueType(code: number): WasmValueType {
  switch (code) {
    case 0x7f:
      return 'i32';
    case 0x7e:
      return 'i64';
    case 0x7d:
      return 'f32';
    case 0x7c:
      return 'f64';
    case 0x7b:
      return 'v128';
    case 0x70:
      return 'funcref';
    case 0x6f:
      return 'externref';
    default:
      return 'unknown';
  }
}

export function decodeExternalKind(code: number): WasmExternalKind {
  switch (code) {
    case 0x00:
      return 'function';
    case 0x01:
      return 'table';
    case 0x02:
      return 'memory';
    case 0x03:
      return 'global';
    case 0x04:
      return 'tag';
    default:
      return 'unknown';
  }
}

export function sectionName(id: number, customName?: string): string {
  if (id === 0) {
    return customName ? `custom:${customName}` : 'custom';
  }
  switch (id) {
    case 1:
      return 'type';
    case 2:
      return 'import';
    case 3:
      return 'function';
    case 4:
      return 'table';
    case 5:
      return 'memory';
    case 6:
      return 'global';
    case 7:
      return 'export';
    case 8:
      return 'start';
    case 9:
      return 'element';
    case 10:
      return 'code';
    case 11:
      return 'data';
    case 12:
      return 'data_count';
    case 13:
      return 'tag';
    default:
      return `section_${id}`;
  }
}

export function readLimits(reader: ByteReader): WasmLimits {
  const flags = reader.readByte();
  const min = reader.readVarUint32();
  const hasMax = (flags & 0x01) !== 0;
  const shared = (flags & 0x02) !== 0;
  const max = hasMax ? reader.readVarUint32() : undefined;
  return {min, max, shared};
}

// ---------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    ),
  ];
}

export function maskValue(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function joinOrNone(values: string[], separator = ', '): string {
  return values.join(separator) || 'none';
}

export function joinOrFallback(
  values: string[],
  fallback: string,
  separator = ', ',
): string {
  return values.join(separator) || fallback;
}

// ---------------------------------------------------------------------------
// String analysis (used by static binary scanning)
// ---------------------------------------------------------------------------

export function looksLikeEncodedMaterial(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 24) {
    return false;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return false;
  }
  if (normalized.length % 4 !== 0) {
    return false;
  }
  if (!/[0-9]/.test(normalized) && !/[+/=]/.test(normalized)) {
    return false;
  }
  return true;
}

export function classifyStringValue(value: string): WasmStringCategory {
  const normalized = value.trim();
  if (
    /^(x-|accept|authorization|content-|referer|origin|user-agent|cookie|sec-)/i.test(
      normalized,
    )
  ) {
    return 'header-like';
  }
  if (/^https?:\/\//i.test(normalized) || /^\/[a-z0-9/_-]+/i.test(normalized)) {
    return 'url-like';
  }
  if (
    (normalized.startsWith('{') && normalized.endsWith('}')) ||
    normalized.includes('":')
  ) {
    return 'json-like';
  }
  if (/^[0-9a-f]{16,}$/i.test(normalized)) {
    return 'hex-like';
  }
  if (looksLikeEncodedMaterial(normalized)) {
    return 'base64-like';
  }
  if (
    /(secret|private|signature|token|nonce|hmac|aes|sm4|sm3|sha|md5|passwd|key)/i.test(
      normalized,
    )
  ) {
    return 'key-material';
  }
  return 'plain-text';
}

export function isSensitiveString(
  value: string,
  category: WasmStringCategory,
): boolean {
  if (
    category === 'key-material' ||
    category === 'base64-like' ||
    category === 'hex-like'
  ) {
    return true;
  }
  return /(secret|private|signature|token|nonce|passwd|key)/i.test(value);
}

export function isLikelyInterestingString(value: string): boolean {
  if (value.length < 4) {
    return false;
  }
  return /[A-Za-z]/.test(value);
}

// ---------------------------------------------------------------------------
// Binary string extraction
// ---------------------------------------------------------------------------

export function readInitExpr(reader: ByteReader): {offset?: number} {
  const opcode = reader.readByte();
  if (opcode === 0x41) {
    const offset = reader.readVarUint32();
    const end = reader.readByte();
    if (end !== 0x0b) {
      throw new Error('Unsupported data segment init expression');
    }
    return {offset};
  }
  if (opcode === 0x23) {
    reader.readVarUint32();
    const end = reader.readByte();
    if (end !== 0x0b) {
      throw new Error('Unsupported global-based data segment init expression');
    }
    return {};
  }
  while (reader.remaining > 0) {
    const value = reader.readByte();
    if (value === 0x0b) {
      break;
    }
  }
  return {};
}

export function extractPrintableRuns(
  bytes: Uint8Array,
  options: {
    source: WasmStringSlot['source'];
    segmentIndex?: number;
    startOffset: number;
    maskSensitiveStrings: boolean;
    maxStringSlots?: number;
  },
): WasmStringSlot[] {
  const slots: WasmStringSlot[] = [];
  let runStart = -1;

  const flush = (end: number) => {
    if (runStart < 0) {
      return;
    }
    const start = runStart;
    const slice = bytes.slice(runStart, end);
    const value = new TextDecoder().decode(slice).trim();
    runStart = -1;
    if (!isLikelyInterestingString(value)) {
      return;
    }
    const category = classifyStringValue(value);
    const masked =
      options.maskSensitiveStrings && isSensitiveString(value, category);
    slots.push({
      offset: options.startOffset + start,
      length: slice.byteLength,
      source: options.source,
      segmentIndex: options.segmentIndex,
      category,
      value,
      displayValue: masked ? maskValue(value) : value,
      masked,
    });
  };

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    const printable = (byte >= 0x20 && byte <= 0x7e) || byte === 0x09;
    if (printable) {
      if (runStart < 0) {
        runStart = index;
      }
      continue;
    }
    if (runStart >= 0 && index - runStart >= 4) {
      flush(index);
      runStart = -1;
    } else {
      runStart = -1;
    }
  }
  if (runStart >= 0 && bytes.length - runStart >= 4) {
    flush(bytes.length);
  }

  const unique = new Map<string, WasmStringSlot>();
  for (const slot of slots) {
    const key = `${slot.offset}:${slot.value}`;
    if (!unique.has(key)) {
      unique.set(key, slot);
    }
  }
  const limited = Array.from(unique.values()).sort(
    (a, b) => a.offset - b.offset,
  );
  if (
    typeof options.maxStringSlots === 'number' &&
    options.maxStringSlots > 0
  ) {
    return limited.slice(0, options.maxStringSlots);
  }
  return limited;
}

// ---------------------------------------------------------------------------
// Header utilities (used by runtime boundary analysis)
// ---------------------------------------------------------------------------

export function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export function isSensitiveHeader(name: string, value: string): boolean {
  return (
    /(authorization|signature|token|secret|key|cookie)/i.test(name) ||
    value.length >= 24
  );
}

// ---------------------------------------------------------------------------
// Body classification (used by runtime boundary analysis)
// ---------------------------------------------------------------------------

export function classifyBodyKind(value?: string): WasmBodyKind {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return 'empty';
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return 'json';
  }
  if (trimmed.includes('=') && trimmed.includes('&')) {
    return 'urlencoded';
  }
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length >= 16) {
    return 'hexish';
  }
  if (/^[A-Za-z0-9+/=_-]+$/.test(trimmed) && trimmed.length >= 16) {
    return 'base64ish';
  }
  return 'plain-text';
}

export function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors.
  }
  return {};
}

function collectBodyParts(body: string, kind: WasmBodyKind): string[] {
  if (kind === 'json') {
    return Object.keys(safeParseJson(body));
  }
  if (kind === 'urlencoded') {
    return body
      .split('&')
      .map(entry => entry.split('=').slice(1).join('=') || entry);
  }
  if (body.includes('.')) {
    return body.split('.');
  }
  if (body.includes(':')) {
    return body.split(':');
  }
  if (body.length > 0) {
    return [body];
  }
  return [];
}

function classifySegmentValue(
  value: string,
): WasmBodySegmentHint['classification'] {
  if (value.length === 0) {
    return 'empty';
  }
  if (/^\d+$/.test(value)) {
    return 'numeric';
  }
  if (/^[0-9a-f]+$/i.test(value) && value.length >= 16) {
    return 'hexish';
  }
  if (/^[A-Za-z0-9+/=_-]+$/.test(value) && value.length >= 16) {
    return 'base64ish';
  }
  if ((value.startsWith('{') && value.endsWith('}')) || value.includes('":')) {
    return 'json';
  }
  if (value.includes('=') && value.includes('&')) {
    return 'urlencoded';
  }
  return 'plain-text';
}

export function splitBodySegments(
  bodySnippet?: string,
  bodyKind?: WasmBodyKind,
): WasmBodySegmentHint[] {
  const body = bodySnippet ?? '';
  const kind = bodyKind ?? classifyBodyKind(body);
  const parts = collectBodyParts(body, kind);

  return parts
    .map((raw, index) => {
      const value = raw.trim();
      const classification = classifySegmentValue(value);
      const likelySignatureMaterial =
        /(sign|signature|token|nonce|hmac|digest)/i.test(value) ||
        classification === 'base64ish' ||
        classification === 'hexish';
      const masked = likelySignatureMaterial && value.length >= 12;
      return {
        index,
        raw: value,
        displayValue: masked ? maskValue(value) : value,
        classification,
        likelySignatureMaterial,
      };
    })
    .filter(entry => entry.raw.length > 0);
}

// ---------------------------------------------------------------------------
// URL / dedup utilities
// ---------------------------------------------------------------------------

export function parseUrlDetails(url?: string): {
  queryOrder?: string;
  queryValues: Map<string, string[]>;
} {
  if (!url) {
    return {
      queryValues: new Map(),
    };
  }
  try {
    const parsed = new URL(url);
    const queryValues = new Map<string, string[]>();
    for (const [key, value] of parsed.searchParams.entries()) {
      const values = queryValues.get(key) ?? [];
      values.push(value);
      queryValues.set(key, values);
    }
    return {
      queryOrder: parsed.search ? parsed.search.slice(1) : undefined,
      queryValues,
    };
  } catch {
    return {
      queryValues: new Map(),
    };
  }
}

export function dedupeHeaders(entries: WasmHeaderEntry[]): WasmHeaderEntry[] {
  const byName = new Map<string, WasmHeaderEntry>();
  for (const entry of entries) {
    const key = normalizeHeaderName(entry.name);
    if (!byName.has(key)) {
      byName.set(key, entry);
    }
  }
  return Array.from(byName.values());
}

export function dedupeKeyValue(
  entries: WasmKeyValuePreview[],
): WasmKeyValuePreview[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = `${entry.key}:${entry.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Runtime analysis helpers
// ---------------------------------------------------------------------------

export type ExportSuspicion = 'high' | 'medium' | 'low';

export function determineSuspicion(
  reasonCount: number,
  callCount: number,
): ExportSuspicion {
  if (reasonCount >= 2 || callCount >= 10) {
    return 'high';
  }
  if (reasonCount === 1 || callCount >= 3) {
    return 'medium';
  }
  return 'low';
}

export interface WasmExportUsageSummary {
  name: string;
  kind: WasmExportEntry['kind'];
  callCount: number;
  params?: WasmExportEntry['params'];
  results?: WasmExportEntry['results'];
  suspicion: 'high' | 'medium' | 'low';
  reasons: string[];
}

export function buildBodyAnalysis(
  writerEvents: WasmRuntimeEvent[],
  readerEvents: WasmRuntimeEvent[],
  sinkEvents: WasmRuntimeEvent[],
): WasmBodyPathAnalysis {
  const sink = sinkEvents[0];
  const bodyKind = sink?.bodyKind ?? classifyBodyKind(sink?.bodySnippet);
  const segments =
    sink?.bodySegments && sink.bodySegments.length > 0
      ? sink.bodySegments.map(segment => ({...segment}))
      : splitBodySegments(sink?.bodySnippet, bodyKind);
  const hints = uniqueStrings([
    bodyKind !== 'unknown' ? `body-kind:${bodyKind}` : undefined,
    writerEvents.some(event => event.type === 'text_encode')
      ? 'text-encode-before-network'
      : undefined,
    readerEvents.some(event => event.type === 'text_decode')
      ? 'text-decode-after-export'
      : undefined,
    segments.some(segment => segment.likelySignatureMaterial)
      ? 'encoded-body-segment-observed'
      : undefined,
  ]);
  return {
    bodyKind,
    segments,
    hints,
    candidateWriters: writerEvents
      .flatMap(event => event.argsPreview ?? [])
      .filter(entry => typeof entry === 'string')
      .slice(0, 6),
    candidateReaders: readerEvents
      .flatMap(event => event.argsPreview ?? [])
      .filter(entry => typeof entry === 'string')
      .slice(0, 6),
  };
}

export function describeRuntimeEvent(event: WasmRuntimeEvent): string {
  switch (event.type) {
    case 'memory_buffer_access':
      return `buffer access on ${event.memoryExportName ?? 'memory'}`;
    case 'memory_view_create':
      return `${event.viewType ?? 'TypedArray'} view @${event.byteOffset ?? 0}:${event.byteLength ?? 0}`;
    case 'memory_write':
      return `${event.viewType ?? 'view'} write @${event.byteOffset ?? 0}:${event.byteLength ?? 0}`;
    case 'memory_read':
      return `${event.viewType ?? 'view'} read @${event.byteOffset ?? 0}:${event.byteLength ?? 0}`;
    case 'text_encode':
      return `TextEncoder -> ${event.viewType ?? 'view'}`;
    case 'text_decode':
      return `TextDecoder <- ${event.viewType ?? 'view'}`;
    default:
      return '';
  }
}

export function describeSink(event: WasmRuntimeEvent): string {
  if (event.type !== 'network_request') {
    return '';
  }
  return `${event.method ?? 'UNKNOWN'} ${event.url ?? 'unknown-url'}`;
}

export function describeStep(event: WasmRuntimeEvent): string {
  switch (event.type) {
    case 'export_call':
      return `call export ${event.exportName ?? 'unknown'}`;
    case 'memory_buffer_access':
      return `access ${event.memoryExportName ?? 'memory'}.buffer`;
    case 'memory_view_create':
      return `create ${event.viewType ?? 'view'} over wasm memory`;
    case 'memory_write':
      return `write via ${event.viewType ?? 'view'}`;
    case 'memory_read':
      return `read via ${event.viewType ?? 'view'}`;
    case 'text_encode':
      return 'encode text into wasm-backed memory';
    case 'text_decode':
      return 'decode text from wasm-backed memory';
    case 'network_request':
      return `network sink ${event.method ?? 'UNKNOWN'} ${event.url ?? 'unknown-url'}`;
    default:
      return event.type;
  }
}
