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
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import type {
  CapturedRequestInput,
  HookRecordInput,
  StorageSnapshotInput,
} from '../../../../src/modules/session/types.js';

function setup(opts?: {
  emitToWs?: (event: {type: string; payload: unknown}) => void;
}): {
  engine: CaptureEngine;
  manager: CaptureSessionManager;
  store: SqliteSessionStore;
  db: DatabaseManager;
} {
  const db = new DatabaseManager(':memory:');
  const store = new SqliteSessionStore(db);
  const manager = new CaptureSessionManager(store);
  const engine = new CaptureEngine(manager, store, opts);
  return {engine, manager, store, db};
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
      assert.strictEqual(snapRow.sessionId, session.id);
      assert.strictEqual(snapRow.key, 'auth_token');

      const storedSnaps = store.getSnapshots(session.id);
      assert.strictEqual(storedSnaps.length, 1);
      assert.strictEqual(storedSnaps[0]?.key, 'auth_token');

      assert.strictEqual(events.length, 4);
      assert.strictEqual(events[0]?.type, 'session.request');
      assert.deepStrictEqual(events[0]?.payload, reqRow1);
      assert.strictEqual(events[1]?.type, 'session.request');
      assert.deepStrictEqual(events[1]?.payload, reqRow2);
      assert.strictEqual(events[2]?.type, 'session.hook');
      assert.deepStrictEqual(events[2]?.payload, hookRow);
      assert.strictEqual(events[3]?.type, 'session.snapshot');
      assert.deepStrictEqual(events[3]?.payload, snapRow);
    } finally {
      db.close();
    }
  });

  it('rejects ingress with "No active session" error when no active session', () => {
    const {engine, db} = setup();

    try {
      const requestInput: CapturedRequestInput = {
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
      };

      assert.throws(
        () => engine.ingestRequest(requestInput),
        /No active session/,
      );

      assert.throws(
        () =>
          engine.ingestHook({
            timestamp: 1700000000000,
            hookType: 'fetch',
            functionName: 'fetch',
            arguments: '[]',
            result: null,
            callStack: null,
          }),
        /No active session/,
      );

      assert.throws(
        () =>
          engine.ingestSnapshot({
            timestamp: 1700000000000,
            kind: 'cookie',
            origin: 'https://example.com',
            key: 'session',
            value: 'val',
          }),
        /No active session/,
      );
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
      assert.strictEqual(row.sessionId, session.id);
    } finally {
      db.close();
    }
  });
});
