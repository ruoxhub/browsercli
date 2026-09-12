/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';

describe('RuntimeConfigStore', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    delete process.env.BROWSER_HEADLESS;
  });

  afterEach(() => {
    process.env = {...originalEnv};
    resetRuntimeConfigStore();
  });

  it('seeds from loadUserConfig on first access', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'proxycli-store-test-'));
    process.env.PROXYCLI_CONFIG_DIR = tmpDir;
    try {
      writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify({
          browser: {browserURL: 'http://seed:9222'},
        }),
        'utf-8',
      );
      resetRuntimeConfigStore();

      const config = getRuntimeConfigStore().get();

      assert.strictEqual(config.browser?.browserURL, 'http://seed:9222');
    } finally {
      delete process.env.PROXYCLI_CONFIG_DIR;
      rmSync(tmpDir, {recursive: true, force: true});
    }
  });

  it('update merges top-level fields', () => {
    resetRuntimeConfigStore({browserUrl: 'http://old:9222', headless: true});

    const store = getRuntimeConfigStore();
    store.update({browserUrl: 'http://new:9222'});

    assert.strictEqual(store.get().browserUrl, 'http://new:9222');
    assert.strictEqual(store.get().headless, true);
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

  it('update shallow-merges nested toolResultRecording field', () => {
    resetRuntimeConfigStore({
      toolResultRecording: {enabled: true, outputDir: '/tmp/orig'},
    });

    const store = getRuntimeConfigStore();
    store.update({toolResultRecording: {enabled: false}});

    assert.strictEqual(store.get().toolResultRecording?.enabled, false);
    assert.strictEqual(store.get().toolResultRecording?.outputDir, '/tmp/orig');
  });

  it('update validates via zod and throws on invalid input', () => {
    resetRuntimeConfigStore();

    assert.throws(
      () =>
        getRuntimeConfigStore().update({
          browser: {remoteDebuggingPort: 1},
        }),
      /REMOTE_DEBUGGING_PORT/,
    );
  });

  it('reset re-seeds the store', () => {
    const store = getRuntimeConfigStore();
    store.update({browserUrl: 'http://modified:9222'});

    resetRuntimeConfigStore({browserUrl: 'http://reset:9222'});

    assert.strictEqual(
      getRuntimeConfigStore().get().browserUrl,
      'http://reset:9222',
    );
  });

  it('get returns a readonly snapshot', () => {
    resetRuntimeConfigStore({browserUrl: 'http://x:9222'});
    const snapshot = getRuntimeConfigStore().get();

    assert.strictEqual(snapshot.browserUrl, 'http://x:9222');
  });
});
