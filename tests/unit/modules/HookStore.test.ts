/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {HookStore} from '../../../src/modules/hook/HookStore.js';

describe('HookStore', () => {
  it('caps records per hook and exposes snapshots', () => {
    const store = new HookStore<{value: number}>(2);

    store.ensure('hook-a');
    store.add('hook-a', {value: 1});
    store.add('hook-a', {value: 2});
    store.add('hook-a', {value: 3});

    assert.deepStrictEqual(store.get('hook-a'), [{value: 2}, {value: 3}]);
    assert.deepStrictEqual(store.getHookIds(), ['hook-a']);
    assert.deepStrictEqual(store.snapshot(), {
      'hook-a': [{value: 2}, {value: 3}],
    });
  });

  it('removes and clears hook buckets', () => {
    const store = new HookStore<{value: number}>();

    store.add('hook-a', {value: 1});
    store.add('hook-b', {value: 2});
    store.clear('hook-a');

    assert.deepStrictEqual(store.get('hook-a'), []);
    assert.strictEqual(store.remove('hook-b'), true);

    store.clear();
    assert.deepStrictEqual(store.getHookIds(), []);
  });

  it('emits sample event after add() succeeds', () => {
    const store = new HookStore<{value: number}>(2);
    const samples: Array<{hookId: string; record: {value: number}}> = [];
    store.events.on('sample', (hookId, record) => {
      samples.push({hookId, record});
    });

    store.add('hook-a', {value: 1});
    store.add('hook-a', {value: 2});
    store.add('hook-b', {value: 3});
    // 触发 ring buffer 淘汰 — 仍应 emit
    store.add('hook-a', {value: 4});

    assert.deepStrictEqual(samples, [
      {hookId: 'hook-a', record: {value: 1}},
      {hookId: 'hook-a', record: {value: 2}},
      {hookId: 'hook-b', record: {value: 3}},
      {hookId: 'hook-a', record: {value: 4}},
    ]);
  });

  it('does not emit sample event when listener is removed', () => {
    const store = new HookStore<{value: number}>();
    const samples: unknown[] = [];
    const listener = (hookId: string, record: {value: number}) => {
      samples.push({hookId, record});
    };

    store.events.on('sample', listener);
    store.add('hook-a', {value: 1});
    store.events.off('sample', listener);
    store.add('hook-a', {value: 2});

    assert.deepStrictEqual(samples, [
      {hookId: 'hook-a', record: {value: 1}},
    ]);
  });
});
