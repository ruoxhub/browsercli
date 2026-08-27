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
  AiReportRow,
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

  it('saves and retrieves ai reports', () => {
    const {store, manager} = makeStore();
    try {
      store.createSession({id: 's1', name: 'demo'});
      const r1: AiReportRow = {
        id: 'rep-1',
        sessionId: 's1',
        mode: 'full',
        sceneHints: 'login flow',
        purifiedSummary: '{"endpoints":["/api/login"]}',
        reportMarkdown: '# Analysis Report',
        messages: JSON.stringify([{role: 'user', content: 'analyze'}]),
        createdAt: 1000,
      };
      const r2: AiReportRow = {
        id: 'rep-2',
        sessionId: 's1',
        mode: 'quick',
        sceneHints: null,
        purifiedSummary: null,
        reportMarkdown: '# Quick Report',
        messages: '[]',
        createdAt: 2000,
      };

      store.saveReport(r1);
      store.saveReport(r2);

      const fetched1 = store.getReport('rep-1');
      assert.deepStrictEqual(fetched1, r1);

      const nonExistent = store.getReport('rep-none');
      assert.strictEqual(nonExistent, null);

      const reports = store.getReports('s1');
      assert.strictEqual(reports.length, 2);
      // Ordered by created_at DESC
      assert.strictEqual(reports[0]?.id, 'rep-2');
      assert.strictEqual(reports[1]?.id, 'rep-1');
      assert.deepStrictEqual(reports[0], r2);
      assert.deepStrictEqual(reports[1], r1);
    } finally {
      manager.close();
    }
  });
});
