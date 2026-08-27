/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';

function makeManager(): {manager: CaptureSessionManager; db: DatabaseManager} {
  const db = new DatabaseManager(':memory:');
  return {manager: new CaptureSessionManager(new SqliteSessionStore(db)), db};
}

describe('CaptureSessionManager', () => {
  it('creates and activates a new session', () => {
    const {manager, db} = makeManager();
    try {
      const row = manager.createSession({
        name: 'demo',
        targetUrl: 'https://example.com',
      });
      assert.strictEqual(row.status, 'capturing');
      assert.strictEqual(row.name, 'demo');
      assert.strictEqual(row.targetUrl, 'https://example.com');
      assert.strictEqual(manager.getActiveSession()?.id, row.id);
      assert.strictEqual(manager.requireActiveSession().id, row.id);
      assert.strictEqual(manager.getSession(row.id)?.id, row.id);
      assert.strictEqual(manager.listSessions().length, 1);
    } finally {
      db.close();
    }
  });

  it('allocates monotonic per-session sequences starting from 1', () => {
    const {manager, db} = makeManager();
    try {
      const a = manager.createSession({name: 'a'});
      assert.strictEqual(manager.nextSequence(a.id), 1);
      assert.strictEqual(manager.nextSequence(a.id), 2);
      assert.strictEqual(manager.nextSequence(a.id), 3);

      const b = manager.createSession({name: 'b'});
      assert.strictEqual(manager.nextSequence(b.id), 1);
      assert.strictEqual(manager.nextSequence(b.id), 2);
      assert.strictEqual(manager.nextSequence(a.id), 4);
    } finally {
      db.close();
    }
  });

  it('rejects illegal status transitions', () => {
    const {manager, db} = makeManager();
    try {
      const row = manager.createSession({name: 'demo'});
      // capturing -> paused (legal)
      manager.transition(row.id, 'paused');
      assert.strictEqual(manager.getSession(row.id)?.status, 'paused');

      // paused -> capturing (legal)
      manager.transition(row.id, 'capturing');
      assert.strictEqual(manager.getSession(row.id)?.status, 'capturing');

      // capturing -> capturing (illegal)
      assert.throws(
        () => manager.transition(row.id, 'capturing'),
        /Invalid session transition: capturing -> capturing/,
      );

      // capturing -> stopped (legal)
      manager.transition(row.id, 'stopped');
      assert.strictEqual(manager.getSession(row.id)?.status, 'stopped');

      // stopped -> capturing (illegal)
      assert.throws(
        () => manager.transition(row.id, 'capturing'),
        /Invalid session transition: stopped -> capturing/,
      );
    } finally {
      db.close();
    }
  });

  it('throws when transitioning non-existent session', () => {
    const {manager, db} = makeManager();
    try {
      assert.throws(
        () => manager.transition('unknown-id', 'capturing'),
        /Session not found: unknown-id/,
      );
    } finally {
      db.close();
    }
  });

  it('throws when no active session', () => {
    const {manager, db} = makeManager();
    try {
      assert.strictEqual(manager.getActiveSession(), null);
      assert.throws(
        () => manager.requireActiveSession(),
        /No active session. Call session_create first./,
      );
    } finally {
      db.close();
    }
  });

  it('delegates getRequests, getHooks, and getSnapshots to store', () => {
    const {manager, db} = makeManager();
    try {
      const session = manager.createSession({name: 'demo'});
      assert.deepStrictEqual(manager.getRequests(session.id), []);
      assert.deepStrictEqual(manager.getHooks(session.id), []);
      assert.deepStrictEqual(manager.getSnapshots(session.id), []);
    } finally {
      db.close();
    }
  });
});
