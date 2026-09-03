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
} from '../../src/config/RuntimeConfigStore.js';
import {parseWorkerArgs} from '../../src/worker/WorkerArgs.js';

describe('Worker main() startup', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    delete process.env.BROWSER_URL;
  });

  afterEach(() => {
    process.env = {...originalEnv};
    resetRuntimeConfigStore();
  });

  it('seeds store with CLI overrides on top of env', () => {
    process.env.BROWSER_URL = 'http://env:9222';
    resetRuntimeConfigStore();

    const cliConfig = parseWorkerArgs(['--browserUrl', 'http://cli:9222']);
    getRuntimeConfigStore().update(cliConfig);

    // CLI 覆盖 env
    assert.strictEqual(
      getRuntimeConfigStore().get().browserUrl,
      'http://cli:9222',
    );
  });

  it('does not auto-connect browser on startup (store has no browser context)', () => {
    resetRuntimeConfigStore();
    const config = getRuntimeConfigStore().get();

    // 启动后 store 存在但 browser 未连接（无 browserContext 设置）
    assert.ok(config);
    assert.strictEqual(config.browser?.browserURL, undefined);
  });
});
