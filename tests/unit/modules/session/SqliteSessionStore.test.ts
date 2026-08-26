/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import type {
  CapturedRequestRow,
  HookRecordRow,
  StorageSnapshotRow,
} from '../../../../src/modules/session/types.js';

function makeStore(): {store: SqliteSessionStore; manager: DatabaseManager} {
  const manager = new DatabaseManager(':memory:');
  return {store: new SqliteSessionStore(manager), manager};
}

describe('SqliteSessionStore', () => {
  it('creates, lists, and updates a session', () => {
    const {store, manager} = makeStore();
    try {
      const row = store.createSession({
        id: 's1',
        name: 'demo',
        targetUrl: 'https://a.dev',
      });
      assert.strictEqual(row.id, 's1');
      assert.strictEqual(row.status, 'capturing');
      assert.strictEqual(store.listSessions().length, 1);

      store.updateSessionStatus('s1', 'stopped');
      assert.strictEqual(store.getSession('s1')?.status, 'stopped');
    } finally {
      manager.close();
    }
  });

  it('appends and filters captured requests', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const req: CapturedRequestRow = {
        id: 's1-1',
        sessionId: 's1',
        sequence: 1,
        timestamp: 100,
        method: 'POST',
        url: 'https://a.dev/api/sign',
        source: 'proxy',
        requestHeaders: '{"content-type":"application/json"}',
        requestBody: '{"q":1}',
        statusCode: 200,
        responseHeaders: null,
        responseBody: '{"ok":true}',
        contentType: 'application/json',
        initiator: null,
        durationMs: 12,
        isStreaming: 0,
        isWebSocket: 0,
        truncated: 0,
      };
      store.appendRequest(req);

      const all = store.getRequests('s1');
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]?.url, req.url);

      assert.strictEqual(
        store.getRequests('s1', {urlFilter: 'SIGN'}).length,
        1,
      );
      assert.strictEqual(
        store.getRequests('s1', {urlFilter: 'missing'}).length,
        0,
      );
      assert.strictEqual(store.getRequests('s1', {sources: ['cdp']}).length, 0);
      assert.strictEqual(
        store.getRequests('s1', {sources: ['proxy']}).length,
        1,
      );
    } finally {
      manager.close();
    }
  });

  it('appends hooks and snapshots', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const hook: HookRecordRow = {
        sessionId: 's1',
        timestamp: 101,
        hookType: 'crypto',
        functionName: 'subtle.encrypt',
        arguments: '["aes-gcm"]',
        result: '{"iv":"...","data":"..."}',
        callStack: 'at sign (app.js:1:1)',
      };
      store.appendHook(hook);
      assert.strictEqual(store.getHooks('s1').length, 1);

      const snap: StorageSnapshotRow = {
        sessionId: 's1',
        timestamp: 102,
        kind: 'cookie',
        origin: 'https://a.dev',
        key: 'session',
        value: 'MASKED',
      };
      store.appendSnapshot(snap);
      assert.strictEqual(store.getSnapshots('s1').length, 1);
    } finally {
      manager.close();
    }
  });
});
