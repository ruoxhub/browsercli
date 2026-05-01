/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {startCommand} from '../../../src/cli/commands/start.js';
import type {WorkerContext} from '../../../src/cli/types.js';
import type {WorkerStartOptions} from '../../../src/types/platform.js';

function createWorkerContext() {
  const starts: WorkerStartOptions[] = [];

  const ctx = {
    rpcHost: 'ws://127.0.0.1:5612',
    group: 'test-group',
    invoker: {
      async isServerAvailable() {
        return true;
      },
      getHttpUrl() {
        return 'http://127.0.0.1:5612';
      },
      async listClients() {
        return {data: [{}]};
      },
    },
    workerManager: {
      isRunning() {
        return false;
      },
      async start(options: WorkerStartOptions) {
        starts.push(options);
      },
    },
    resolvedConfig: {
      rpcHost: 'ws://127.0.0.1:5612',
      group: 'test-group',
      headless: false,
      runtimeDirName: 'js-reverse',
      debug: false,
      databaseUrl: 'postgresql://from-config/db',
    },
    config: {},
  } as unknown as WorkerContext;

  return {ctx, starts};
}

describe('start command', () => {
  it('passes databaseUrl from CLI args to worker start options', async () => {
    const {ctx, starts} = createWorkerContext();

    await startCommand(
      ['--databaseUrl', 'postgresql://from-cli/db'],
      ctx,
    );

    assert.strictEqual(starts.length, 1);
    assert.strictEqual(starts[0]?.rpcHost, 'ws://127.0.0.1:5612');
    assert.strictEqual(starts[0]?.group, 'test-group');
    assert.strictEqual(starts[0]?.headless, false);
    assert.strictEqual(starts[0]?.databaseUrl, 'postgresql://from-cli/db');
  });

  it('falls back to resolved databaseUrl when CLI arg is absent', async () => {
    const {ctx, starts} = createWorkerContext();

    await startCommand([], ctx);

    assert.strictEqual(starts.length, 1);
    assert.strictEqual(starts[0]?.databaseUrl, 'postgresql://from-config/db');
  });
});
