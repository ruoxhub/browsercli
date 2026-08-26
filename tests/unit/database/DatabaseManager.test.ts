/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';

function tableNames(db: ReturnType<DatabaseManager['getDb']>): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    )
    .all() as Array<{name: string}>;
  return rows.map(r => r.name);
}

describe('DatabaseManager', () => {
  it('creates all session tables and sets user_version', () => {
    const manager = new DatabaseManager(':memory:');
    try {
      const db = manager.getDb();
      const names = tableNames(db);
      for (const t of [
        'sessions',
        'captured_requests',
        'hook_records',
        'storage_snapshots',
        'ai_reports',
      ]) {
        assert.ok(names.includes(t), `missing table ${t}`);
      }
      const version = db.pragma('user_version', {simple: true});
      assert.strictEqual(version, 1);
    } finally {
      manager.close();
    }
  });

  it('enforces the status CHECK constraint', () => {
    const manager = new DatabaseManager(':memory:');
    try {
      const db = manager.getDb();
      assert.throws(() => {
        db.prepare(
          `INSERT INTO sessions (id, name, status, created_at, updated_at)
           VALUES ('s1', 'x', 'bogus', 1, 1)`,
        ).run();
      }, /CHECK/i);
    } finally {
      manager.close();
    }
  });

  it('returns same db instance on subsequent calls and handles close', () => {
    const manager = new DatabaseManager(':memory:');
    try {
      const db1 = manager.init();
      const db2 = manager.getDb();
      assert.strictEqual(db1, db2);
      assert.strictEqual(manager.path, ':memory:');
    } finally {
      manager.close();
    }
    // After close, close() can be safely called again
    manager.close();
  });
});
