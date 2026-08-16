/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {getRuntimeConfigStore, resetRuntimeConfigStore} from '../../src/config/RuntimeConfigStore.js';
import {parseWorkerArgs} from '../../src/worker/WorkerArgs.js';

describe('Worker main() startup', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    delete process.env.RPC_HOST;
  });

  afterEach(() => {
    process.env = {...originalEnv};
    resetRuntimeConfigStore();
  });

  it('seeds store with CLI overrides on top of env', () => {
    process.env.RPC_HOST = 'ws://env:5612';
    resetRuntimeConfigStore();

    const cliConfig = parseWorkerArgs(['--rpcHost', 'ws://cli:5612']);
    getRuntimeConfigStore().update(cliConfig);

    // CLI 覆盖 env
    assert.strictEqual(getRuntimeConfigStore().get().rpcHost, 'ws://cli:5612');
  });

  it('does not auto-connect browser on startup (store has no browser context)', () => {
    resetRuntimeConfigStore();
    const config = getRuntimeConfigStore().get();

    // 启动后 store 存在但 browser 未连接（无 browserContext 设置）
    assert.ok(config);
    assert.strictEqual(config.browser?.browserURL, undefined);
  });
});
