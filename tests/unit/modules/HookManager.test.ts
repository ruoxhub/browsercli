/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {HookManager} from '../../../src/modules/hook/HookManager.js';

describe('HookManager', () => {
  it('returns one persistent registry per HookManager', () => {
    const manager = new HookManager();

    assert.equal(
      manager.getPersistentHookRegistry(),
      manager.getPersistentHookRegistry(),
    );
    assert.notEqual(
      manager.getPersistentHookRegistry(),
      new HookManager().getPersistentHookRegistry(),
    );
  });

  it('creates/lists/removes hooks', () => {
    const manager = new HookManager();

    const created = manager.create({
      type: 'fetch',
      params: {},
      description: 'fetch hook',
    });

    assert.ok(created.hookId);
    assert.ok(created.script.includes('fetch'));
    assert.strictEqual(manager.getAllHooks().length, 1);

    const removed = manager.remove(created.hookId);
    assert.strictEqual(removed, true);
    assert.strictEqual(manager.getAllHooks().length, 0);
  });

  it('transparently carries protocolFallback through create()', () => {
    const manager = new HookManager();

    const result = manager.create({type: 'fetch', protocolFallback: true});
    assert.equal(result.protocolFallback, true);
  });

  it('omits protocolFallback when not provided', () => {
    const manager = new HookManager();

    const result = manager.create({type: 'fetch'});
    assert.equal(result.protocolFallback, undefined);
  });
});
