/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type Database from 'better-sqlite3';

import type {DatabaseManager} from '../../database/DatabaseManager.js';
import {compileFlowFilter} from '../proxy/flowFilter.js';

import {LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT} from './constants.js';
import type {SessionStore} from './SessionStore.js';
import {toSummary} from './summary.js';
import type {
  AiReportRow,
  CapturedRequestRow,
  CapturedRequestSummary,
  HookRecordRow,
  RequestFilter,
  SessionRow,
  SessionStatus,
  StorageSnapshotRow,
} from './types.js';

interface SessionDbRow {
  id: string;
  name: string;
  target_url: string | null;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
  meta: string | null;
}

interface RequestDbRow {
  id: string;
  session_id: string;
  sequence: number;
  timestamp: number;
  method: string;
  url: string;
  source: 'cdp' | 'proxy';
  request_headers: string;
  request_body: string | null;
  status_code: number;
  response_headers: string | null;
  response_body: string | null;
  content_type: string | null;
  initiator: string | null;
  duration_ms: number;
  is_streaming: number;
  is_websocket: number;
  truncated: number;
}

/** listRequestSummaries 的显式列投影结果：类型上刻意不含 body/headers，SELECT 也拿不到。 */
type RequestSummaryDbRow = Pick<
  RequestDbRow,
  | 'id'
  | 'session_id'
  | 'sequence'
  | 'timestamp'
  | 'method'
  | 'url'
  | 'source'
  | 'initiator'
  | 'status_code'
  | 'content_type'
  | 'truncated'
  | 'is_streaming'
>;

interface HookDbRow {
  session_id: string;
  timestamp: number;
  hook_type: HookRecordRow['hookType'];
  function_name: string;
  arguments: string;
  result: string | null;
  call_stack: string | null;
}

interface SnapshotDbRow {
  session_id: string;
  timestamp: number;
  kind: StorageSnapshotRow['kind'];
  origin: string;
  key: string;
  value: string | null;
}

interface AiReportDbRow {
  id: string;
  session_id: string;
  mode: string;
  scene_hints: string | null;
  purified_summary: string | null;
  report_markdown: string;
  messages: string;
  created_at: number;
}

const toSession = (r: SessionDbRow): SessionRow => ({
  id: r.id,
  name: r.name,
  targetUrl: r.target_url,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  meta: r.meta,
});

const toRequest = (r: RequestDbRow): CapturedRequestRow => ({
  id: r.id,
  sessionId: r.session_id,
  sequence: r.sequence,
  timestamp: r.timestamp,
  method: r.method,
  url: r.url,
  source: r.source,
  requestHeaders: r.request_headers,
  requestBody: r.request_body,
  statusCode: r.status_code,
  responseHeaders: r.response_headers,
  responseBody: r.response_body,
  contentType: r.content_type,
  initiator: r.initiator,
  durationMs: r.duration_ms,
  isStreaming: r.is_streaming,
  isWebSocket: r.is_websocket,
  truncated: r.truncated,
});

const toHook = (r: HookDbRow): HookRecordRow => ({
  sessionId: r.session_id,
  timestamp: r.timestamp,
  hookType: r.hook_type,
  functionName: r.function_name,
  arguments: r.arguments,
  result: r.result,
  callStack: r.call_stack,
});

const toSnapshot = (r: SnapshotDbRow): StorageSnapshotRow => ({
  sessionId: r.session_id,
  timestamp: r.timestamp,
  kind: r.kind,
  origin: r.origin,
  key: r.key,
  value: r.value,
});

const toReport = (r: AiReportDbRow): AiReportRow => ({
  id: r.id,
  sessionId: r.session_id,
  mode: r.mode,
  sceneHints: r.scene_hints,
  purifiedSummary: r.purified_summary,
  reportMarkdown: r.report_markdown,
  messages: r.messages,
  createdAt: r.created_at,
});

export class SqliteSessionStore implements SessionStore {
  private readonly manager: DatabaseManager;
  private readonly db: Database.Database;

  constructor(manager: DatabaseManager) {
    this.manager = manager;
    this.db = manager.getDb();
  }

  createSession(input: {
    id: string;
    name: string;
    targetUrl?: string | null;
  }): SessionRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, name, target_url, status, created_at, updated_at, meta)
         VALUES (?, ?, ?, 'capturing', ?, ?, NULL)`,
      )
      .run(input.id, input.name, input.targetUrl ?? null, now, now);
    return this.getSession(input.id) as SessionRow;
  }

  updateSessionStatus(id: string, status: SessionStatus): void {
    this.db
      .prepare(`UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, Date.now(), id);
  }

  getSession(id: string): SessionRow | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as SessionDbRow | undefined;
    return row ? toSession(row) : null;
  }

  listSessions(): SessionRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC`)
      .all() as SessionDbRow[];
    return rows.map(toSession);
  }

  appendRequest(row: CapturedRequestRow): void {
    this.db
      .prepare(
        `INSERT INTO captured_requests (
           id, session_id, sequence, timestamp, method, url, source,
           request_headers, request_body, status_code, response_headers,
           response_body, content_type, initiator, duration_ms,
           is_streaming, is_websocket, truncated
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.sessionId,
        row.sequence,
        row.timestamp,
        row.method,
        row.url,
        row.source,
        row.requestHeaders,
        row.requestBody,
        row.statusCode,
        row.responseHeaders,
        row.responseBody,
        row.contentType,
        row.initiator,
        row.durationMs,
        row.isStreaming,
        row.isWebSocket,
        row.truncated,
      );
  }

  appendHook(row: HookRecordRow): void {
    this.db
      .prepare(
        `INSERT INTO hook_records (
           session_id, timestamp, hook_type, function_name, arguments, result, call_stack
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.sessionId,
        row.timestamp,
        row.hookType,
        row.functionName,
        row.arguments,
        row.result,
        row.callStack,
      );
  }

  appendSnapshot(row: StorageSnapshotRow): void {
    this.db
      .prepare(
        `INSERT INTO storage_snapshots (
           session_id, timestamp, kind, origin, key, value
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.sessionId,
        row.timestamp,
        row.kind,
        row.origin,
        row.key,
        row.value,
      );
  }

  getRequests(
    sessionId: string,
    filter: RequestFilter = {},
  ): CapturedRequestRow[] {
    const clauses = ['session_id = ?'];
    const params: unknown[] = [sessionId];

    if (filter.sources && filter.sources.length > 0) {
      clauses.push(`source IN (${filter.sources.map(() => '?').join(', ')})`);
      params.push(...filter.sources);
    }
    if (filter.urlFilter) {
      clauses.push('lower(url) LIKE ?');
      params.push(`%${filter.urlFilter.toLowerCase()}%`);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM captured_requests WHERE ${clauses.join(' AND ')} ORDER BY sequence ASC`,
      )
      .all(...params) as RequestDbRow[];
    const mapped = rows.map(toRequest);
    if (filter.filter) {
      const filterFn = compileFlowFilter(filter.filter, {fallbackFuzzy: true});
      return mapped.filter(r =>
        filterFn({
          url: r.url,
          method: r.method,
          statusCode: r.statusCode,
          contentType: r.contentType,
          requestHeaders: r.requestHeaders,
          requestBody: r.requestBody,
          responseHeaders: r.responseHeaders,
          responseBody: r.responseBody,
          initiator: r.initiator,
          isWebSocket: Boolean(r.isWebSocket),
        }),
      );
    }
    return mapped;
  }

  getRequest(id: string): CapturedRequestRow | null {
    const row = this.db
      .prepare(`SELECT * FROM captured_requests WHERE id = ?`)
      .get(id) as RequestDbRow | undefined;
    return row ? toRequest(row) : null;
  }

  listRequestSummaries(
    sessionId: string,
    filter: RequestFilter = {},
    page: {limit?: number; offset?: number} = {},
  ): CapturedRequestSummary[] {
    const clauses: string[] = [`session_id = ?`];
    const params: unknown[] = [sessionId];

    if (filter.sources && filter.sources.length > 0) {
      const placeholders = filter.sources.map(() => '?').join(', ');
      clauses.push(`source IN (${placeholders})`);
      params.push(...filter.sources);
    }
    if (filter.urlFilter) {
      // 与 getRequests（:265-268）完全同款匹配语义，避免两条读路径行为分叉。
      clauses.push('lower(url) LIKE ?');
      params.push(`%${filter.urlFilter.toLowerCase()}%`);
    }

    const limit = Math.min(
      Math.max(page.limit ?? LIST_DEFAULT_LIMIT, 1),
      LIST_MAX_LIMIT,
    );
    const offset = Math.max(page.offset ?? 0, 0);

    if (!filter.filter) {
      const rows = this.db
        .prepare(
          `SELECT id, session_id, sequence, timestamp, method, url, source, initiator,
                  status_code, content_type, truncated, is_streaming
           FROM captured_requests
           WHERE ${clauses.join(' AND ')}
           ORDER BY sequence DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as RequestSummaryDbRow[];

      return rows.map(r =>
        toSummary({
          id: r.id,
          sessionId: r.session_id,
          sequence: r.sequence,
          timestamp: r.timestamp,
          method: r.method,
          url: r.url,
          statusCode: r.status_code,
          contentType: r.content_type,
          source: r.source,
          initiator: r.initiator,
          truncated: r.truncated,
          isStreaming: r.is_streaming,
        }),
      );
    }

    const filterFn = compileFlowFilter(filter.filter, {fallbackFuzzy: true});
    const allRows = this.db
      .prepare(
        `SELECT id, session_id, sequence, timestamp, method, url, source, initiator,
                status_code, content_type, truncated, is_streaming,
                request_headers, request_body, response_headers, response_body, is_websocket
         FROM captured_requests
         WHERE ${clauses.join(' AND ')}
         ORDER BY sequence DESC`,
      )
      .all(...params) as Array<
      RequestSummaryDbRow & {
        request_headers: string;
        request_body: string | null;
        response_headers: string | null;
        response_body: string | null;
        is_websocket: number;
      }
    >;

    const matched = allRows.filter(r =>
      filterFn({
        url: r.url,
        method: r.method,
        statusCode: r.status_code,
        contentType: r.content_type,
        requestHeaders: r.request_headers,
        requestBody: r.request_body,
        responseHeaders: r.response_headers,
        responseBody: r.response_body,
        initiator: r.initiator,
        isWebSocket: Boolean(r.is_websocket),
      }),
    );

    const paged = matched.slice(offset, offset + limit);
    return paged.map(r =>
      toSummary({
        id: r.id,
        sessionId: r.session_id,
        sequence: r.sequence,
        timestamp: r.timestamp,
        method: r.method,
        url: r.url,
        statusCode: r.status_code,
        contentType: r.content_type,
        source: r.source,
        initiator: r.initiator,
        truncated: r.truncated,
        isStreaming: r.is_streaming,
      }),
    );
  }

  trimRequests(sessionId: string, keepLast: number): number {
    const info = this.db
      .prepare(
        `DELETE FROM captured_requests
         WHERE session_id = ?
           AND sequence <= (
             SELECT sequence FROM captured_requests
             WHERE session_id = ?
             ORDER BY sequence DESC
             LIMIT 1 OFFSET ?
           )`,
      )
      .run(sessionId, sessionId, keepLast);
    return info.changes;
  }

  clearRequests(sessionId: string): number {
    const info = this.db
      .prepare(`DELETE FROM captured_requests WHERE session_id = ?`)
      .run(sessionId);
    return info.changes;
  }

  getHooks(sessionId: string): HookRecordRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM hook_records WHERE session_id = ? ORDER BY timestamp ASC`,
      )
      .all(sessionId) as HookDbRow[];
    return rows.map(toHook);
  }

  getSnapshots(sessionId: string): StorageSnapshotRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM storage_snapshots WHERE session_id = ? ORDER BY timestamp ASC`,
      )
      .all(sessionId) as SnapshotDbRow[];
    return rows.map(toSnapshot);
  }

  saveReport(row: AiReportRow): void {
    this.db
      .prepare(
        `INSERT INTO ai_reports (
           id, session_id, mode, scene_hints, purified_summary,
           report_markdown, messages, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.sessionId,
        row.mode,
        row.sceneHints,
        row.purifiedSummary,
        row.reportMarkdown,
        row.messages,
        row.createdAt,
      );
  }

  getReport(id: string): AiReportRow | null {
    const row = this.db
      .prepare(`SELECT * FROM ai_reports WHERE id = ?`)
      .get(id) as AiReportDbRow | undefined;
    return row ? toReport(row) : null;
  }

  getReports(sessionId: string): AiReportRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ai_reports WHERE session_id = ? ORDER BY created_at DESC`,
      )
      .all(sessionId) as AiReportDbRow[];
    return rows.map(toReport);
  }

  close(): void {
    this.manager.close();
  }
}
