/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {beforeEach, describe, it} from 'node:test';

import {InvocationStore} from '../../../../src/web/adapters/InvocationStore.js';
import type {InvocationRecord} from '../../../../src/web/types.js';

const baseRecord: Omit<InvocationRecord, 'id'> = {
  traceId: 'tr_test_001',
  toolName: 'collect_scripts',
  success: true,
  startedAt: '2026-05-27T00:00:00.000Z',
  durationMs: 12,
};

describe('InvocationStore', () => {
  let store: InvocationStore;

  beforeEach(() => {
    store = new InvocationStore(3);
  });

  it('add() assigns rec_-prefixed id and returns the full record', () => {
    const r = store.add(baseRecord);
    assert.match(r.id, /^rec_/);
    assert.strictEqual(r.traceId, 'tr_test_001');
    assert.strictEqual(r.toolName, 'collect_scripts');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.durationMs, 12);
    assert.strictEqual(store.size(), 1);
  });

  it('getRecent() returns records in reverse-chronological order', () => {
    store.add({...baseRecord, traceId: 'tr_001'});
    store.add({...baseRecord, traceId: 'tr_002'});
    store.add({...baseRecord, traceId: 'tr_003'});

    const recent = store.getRecent();
    assert.strictEqual(recent.length, 3);
    assert.deepStrictEqual(
      recent.map(r => r.traceId),
      ['tr_003', 'tr_002', 'tr_001'],
    );
  });

  it('getRecent(limit) honors the limit when smaller than store size', () => {
    store.add({...baseRecord, traceId: 'tr_001'});
    store.add({...baseRecord, traceId: 'tr_002'});
    store.add({...baseRecord, traceId: 'tr_003'});

    const recent = store.getRecent(2);
    assert.deepStrictEqual(
      recent.map(r => r.traceId),
      ['tr_003', 'tr_002'],
    );
  });

  it('getRecent(limit) returns all when limit exceeds store size', () => {
    store.add({...baseRecord, traceId: 'tr_001'});
    const recent = store.getRecent(99);
    assert.strictEqual(recent.length, 1);
  });

  it('ring buffer evicts oldest record when capacity is reached', () => {
    store.add({...baseRecord, traceId: 'tr_001'});
    store.add({...baseRecord, traceId: 'tr_002'});
    store.add({...baseRecord, traceId: 'tr_003'});
    store.add({...baseRecord, traceId: 'tr_004'});

    assert.strictEqual(store.size(), 3, '上限是 3，第 4 条应淘汰最旧的 tr_001');
    const traceIds = store.getRecent().map(r => r.traceId);
    assert.deepStrictEqual(traceIds, ['tr_004', 'tr_003', 'tr_002']);
    assert.strictEqual(store.getByTraceId('tr_001'), undefined);
  });

  it('getById() returns the matching record or undefined', () => {
    const r1 = store.add({...baseRecord, traceId: 'tr_001'});
    const r2 = store.add({...baseRecord, traceId: 'tr_002'});

    assert.strictEqual(store.getById(r1.id)?.traceId, 'tr_001');
    assert.strictEqual(store.getById(r2.id)?.traceId, 'tr_002');
    assert.strictEqual(store.getById('rec_nonexistent'), undefined);
  });

  it('getByTraceId() returns the matching record or undefined', () => {
    store.add({...baseRecord, traceId: 'tr_match'});
    store.add({...baseRecord, traceId: 'tr_other'});

    assert.strictEqual(store.getByTraceId('tr_match')?.traceId, 'tr_match');
    assert.strictEqual(store.getByTraceId('tr_missing'), undefined);
  });

  it('add() generates unique ids for back-to-back inserts', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(store.add({...baseRecord, traceId: `tr_${i}`}).id);
    }
    // 50 inserts capped at size=3, but ids must all be unique pre-eviction
    assert.strictEqual(ids.size, 50);
  });

  it('clear() empties the buffer and resets sequence', () => {
    store.add({...baseRecord, traceId: 'tr_001'});
    store.add({...baseRecord, traceId: 'tr_002'});
    store.clear();
    assert.strictEqual(store.size(), 0);
    assert.deepStrictEqual(store.getRecent(), []);
  });
});
