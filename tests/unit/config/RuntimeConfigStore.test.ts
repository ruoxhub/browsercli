/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';

describe('RuntimeConfigStore', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.BROWSER_HEADLESS;
    delete process.env.DEFAULT_LLM_PROVIDER;
  });

  afterEach(() => {
    process.env = {...originalEnv};
    resetRuntimeConfigStore();
  });

  it('seeds from configFromEnv on first access', () => {
    process.env.OPENAI_API_KEY = 'sk-seed';
    process.env.DEFAULT_LLM_PROVIDER = 'openai';
    resetRuntimeConfigStore();

    const config = getRuntimeConfigStore().get();

    assert.strictEqual(config.openai?.apiKey, 'sk-seed');
    assert.strictEqual(config.llmProvider, 'openai');
  });

  it('update merges top-level fields', () => {
    resetRuntimeConfigStore({rpcHost: 'ws://old', group: 'g1'});

    const store = getRuntimeConfigStore();
    store.update({rpcHost: 'ws://new'});

    assert.strictEqual(store.get().rpcHost, 'ws://new');
    assert.strictEqual(store.get().group, 'g1');
  });

  it('update shallow-merges nested browser field', () => {
    resetRuntimeConfigStore({
      browser: {headless: true, channel: 'stable'},
    });

    const store = getRuntimeConfigStore();
    store.update({browser: {headless: false}});

    // headless 被覆盖，channel 被保留（浅合并）
    assert.strictEqual(store.get().browser?.headless, false);
    assert.strictEqual(store.get().browser?.channel, 'stable');
  });

  it('update shallow-merges nested openai field', () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-orig', model: 'gpt-4o'},
    });

    const store = getRuntimeConfigStore();
    store.update({openai: {apiKey: 'sk-new'}});

    assert.strictEqual(store.get().openai?.apiKey, 'sk-new');
    assert.strictEqual(store.get().openai?.model, 'gpt-4o');
  });

  it('update validates via zod and throws on invalid input', () => {
    resetRuntimeConfigStore();

    assert.throws(
      () => getRuntimeConfigStore().update({llmProvider: 'invalid-provider' as never}),
      /llmProvider/,
    );
  });

  it('reset re-seeds the store', () => {
    const store = getRuntimeConfigStore();
    store.update({rpcHost: 'ws://modified'});

    resetRuntimeConfigStore({rpcHost: 'ws://reset'});

    assert.strictEqual(getRuntimeConfigStore().get().rpcHost, 'ws://reset');
  });

  it('get returns a readonly snapshot', () => {
    resetRuntimeConfigStore({rpcHost: 'ws://x'});
    const snapshot = getRuntimeConfigStore().get();

    assert.strictEqual(snapshot.rpcHost, 'ws://x');
  });
});
