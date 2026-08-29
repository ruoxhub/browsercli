/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {
  DEFAULT_SESSION_NAME,
  TRIM_EVERY_INGESTS,
} from '../../../../src/modules/session/constants.js';
import type {SessionStore} from '../../../../src/modules/session/SessionStore.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import type {
  CapturedRequestInput,
  HookRecordInput,
  SessionRow,
  StorageSnapshotInput,
} from '../../../../src/modules/session/types.js';

function setup(opts?: {
  emitToWs?: (event: {type: string; payload: unknown}) => void;
  store?: SessionStore;
  keepLast?: number;
  trimEveryIngests?: number;
}): {
  engine: CaptureEngine;
  manager: CaptureSessionManager;
  store: SessionStore;
  db: DatabaseManager;
} {
  const db = new DatabaseManager(':memory:');
  const store = opts?.store ?? new SqliteSessionStore(db);
  const manager = new CaptureSessionManager(store);
  const engine = new CaptureEngine(manager, store, opts);
  return {engine, manager, store, db};
}

const defaultRequestInput: CapturedRequestInput = {
  timestamp: 1700000000000,
  method: 'POST',
  url: 'https://example.com/api/data',
  source: 'cdp',
  requestHeaders: '{"Content-Type":"application/json"}',
  requestBody: '{"q":1}',
  statusCode: 200,
  responseHeaders: '{"Content-Type":"application/json"}',
  responseBody: '{"ok":true}',
  contentType: 'application/json',
  initiator: null,
  durationMs: 0,
  isStreaming: 0,
  isWebSocket: 0,
  truncated: 0,
};

function makeFakeStore(overrides: Partial<SessionStore> = {}): SessionStore {
  const session: SessionRow = {
    id: 'fake-session',
    name: DEFAULT_SESSION_NAME,
    targetUrl: null,
    status: 'capturing',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    meta: null,
  };
  return {
    createSession: () => session,
    updateSessionStatus: () => undefined,
    getSession: id => (id === session.id ? session : null),
    listSessions: () => [session],
    appendRequest: () => undefined,
    appendHook: () => undefined,
    appendSnapshot: () => undefined,
    getRequests: () => [],
    getRequest: () => null,
    listRequestSummaries: () => [],
    trimRequests: () => 0,
    clearRequests: () => 0,
    getHooks: () => [],
    getSnapshots: () => [],
    saveReport: () => undefined,
    getReport: () => null,
    getReports: () => [],
    close: () => undefined,
    ...overrides,
  };
}

describe('CaptureEngine', () => {
  it('normalizes ingress into active session and emits websocket events for request, hook, snapshot', () => {
    const events: Array<{type: string; payload: unknown}> = [];
    const {engine, manager, store, db} = setup({
      emitToWs: event => events.push(event),
    });

    try {
      const session = manager.createSession({
        name: 'test-session',
        targetUrl: 'https://example.com',
      });

      const requestInput: CapturedRequestInput = {
        timestamp: 1700000000000,
        method: 'POST',
        url: 'https://example.com/api/data',
        source: 'cdp',
        requestHeaders: '{"Content-Type":"application/json"}',
        requestBody: '{"q":1}',
        statusCode: 200,
        responseHeaders: '{"Content-Type":"application/json"}',
        responseBody: '{"ok":true}',
        contentType: 'application/json',
        initiator: 'https://example.com/app.js:10',
        durationMs: 42,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      };

      const reqRow1 = engine.ingestRequest(requestInput);
      assert.strictEqual(reqRow1.id, `${session.id}-1`);
      assert.strictEqual(reqRow1.sessionId, session.id);
      assert.strictEqual(reqRow1.sequence, 1);
      assert.strictEqual(reqRow1.url, 'https://example.com/api/data');

      const reqRow2 = engine.ingestRequest({
        ...requestInput,
        url: 'https://example.com/api/data2',
      });
      assert.strictEqual(reqRow2.id, `${session.id}-2`);
      assert.strictEqual(reqRow2.sequence, 2);

      const storedRequests = store.getRequests(session.id);
      assert.strictEqual(storedRequests.length, 2);
      assert.strictEqual(storedRequests[0]?.id, `${session.id}-1`);
      assert.strictEqual(storedRequests[1]?.id, `${session.id}-2`);

      const hookInput: HookRecordInput = {
        timestamp: 1700000000100,
        hookType: 'fetch',
        functionName: 'window.fetch',
        arguments: '["https://example.com/api/data"]',
        result: 'Promise<Response>',
        callStack: 'Error\\n    at fetch (app.js:10:5)',
      };

      const hookRow = engine.ingestHook(hookInput);
      assert.ok(hookRow);
      assert.strictEqual(hookRow.sessionId, session.id);
      assert.strictEqual(hookRow.functionName, 'window.fetch');

      const storedHooks = store.getHooks(session.id);
      assert.strictEqual(storedHooks.length, 1);
      assert.strictEqual(storedHooks[0]?.functionName, 'window.fetch');

      const snapshotInput: StorageSnapshotInput = {
        timestamp: 1700000000200,
        kind: 'local',
        origin: 'https://example.com',
        key: 'auth_token',
        value: 'xyz123',
      };

      const snapRow = engine.ingestSnapshot(snapshotInput);
      assert.ok(snapRow);
      assert.strictEqual(snapRow.sessionId, session.id);
      assert.strictEqual(snapRow.key, 'auth_token');

      const storedSnaps = store.getSnapshots(session.id);
      assert.strictEqual(storedSnaps.length, 1);
      assert.strictEqual(storedSnaps[0]?.key, 'auth_token');

      assert.strictEqual(events.length, 4);
      assert.strictEqual(events[0]?.type, 'session.request');
      assert.deepStrictEqual(events[0]?.payload, {
        id: reqRow1.id,
        sessionId: reqRow1.sessionId,
        sequence: reqRow1.sequence,
        timestamp: reqRow1.timestamp,
        method: reqRow1.method,
        url: reqRow1.url,
        statusCode: reqRow1.statusCode,
        contentType: reqRow1.contentType,
        source: reqRow1.source,
        truncated: reqRow1.truncated,
        isStreaming: reqRow1.isStreaming,
      });
      assert.strictEqual(
        'responseBody' in (events[0]?.payload as object),
        false,
        'WS payload 必须是摘要，不得含 body（spec §8 / R1）',
      );
      assert.strictEqual(
        'initiator' in (events[0]?.payload as object),
        false,
        '摘要不含 initiator / durationMs（v2 的 source_ref 才恢复）',
      );
      assert.strictEqual(events[1]?.type, 'session.request');
      assert.strictEqual(
        (events[1]?.payload as {sequence: number}).sequence,
        reqRow2.sequence,
      );
      assert.strictEqual(events[2]?.type, 'session.hook');
      assert.deepStrictEqual(events[2]?.payload, hookRow);
      assert.strictEqual(events[3]?.type, 'session.snapshot');
      assert.deepStrictEqual(events[3]?.payload, snapRow);
    } finally {
      db.close();
    }
  });

  it('auto-creates the default session on the first ingest', () => {
    const {engine, manager, db} = setup();
    try {
      assert.strictEqual(manager.getActiveSession(), null);
      const row = engine.ingestRequest(defaultRequestInput);
      const session = manager.getActiveSession();
      assert.ok(row);
      assert.ok(session);
      assert.strictEqual(session.name, 'default');
      assert.strictEqual(row?.sessionId, session.id);
      assert.strictEqual(row?.sequence, 1);
    } finally {
      db.close();
    }
  });

  it('isolates store failures from the producer and counts them', () => {
    const failing = makeFakeStore({
      appendRequest: () => {
        throw new Error('SQLITE_BUSY');
      },
    });
    const {engine, db} = setup({store: failing});
    try {
      assert.strictEqual(engine.ingestRequest(defaultRequestInput), null);
      assert.strictEqual(engine.getFailureCount(), 1);
      assert.strictEqual(engine.ingestRequest(defaultRequestInput), null);
      assert.strictEqual(engine.getFailureCount(), 2);
    } finally {
      db.close();
    }
  });

  it('trims to the quota every trimEveryIngests successful appends', () => {
    let trimmed: number | null = null;
    const tracking = makeFakeStore({
      trimRequests: (_sessionId, keepLast) => {
        trimmed = keepLast;
        return 0;
      },
    });
    const {engine, db} = setup({
      store: tracking,
      keepLast: 1234,
      trimEveryIngests: 2,
    });
    try {
      engine.ingestRequest(defaultRequestInput);
      assert.strictEqual(trimmed, null, 'first ingest below the interval');
      engine.ingestRequest(defaultRequestInput);
      assert.strictEqual(trimmed, 1234, 'second ingest crosses the interval');
      assert.strictEqual(TRIM_EVERY_INGESTS, 200, 'production default');
    } finally {
      db.close();
    }
  });

  it('works without emitToWs callback provided', () => {
    const {engine, manager, db} = setup();
    try {
      const session = manager.createSession({name: 'no-ws'});
      const row = engine.ingestRequest({
        timestamp: 1700000000000,
        method: 'GET',
        url: 'https://example.com',
        source: 'cdp',
        requestHeaders: '{}',
        requestBody: null,
        statusCode: 200,
        responseHeaders: null,
        responseBody: null,
        contentType: null,
        initiator: null,
        durationMs: 10,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      });
      assert.ok(row);
      assert.strictEqual(row.sessionId, session.id);
    } finally {
      db.close();
    }
  });
});
