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
});
