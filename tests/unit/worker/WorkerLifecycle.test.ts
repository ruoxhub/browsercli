/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {createGracefulShutdown} from '../../../src/worker/WorkerLifecycle.js';

describe('WorkerLifecycle', () => {
  it('disconnects client, closes browser and database, then exits once', async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      browserManager: {
        close: async () => {
          calls.push('browser.close');
        },
      } as never,
      client: {
        disconnect: () => {
          calls.push('client.disconnect');
        },
      } as never,
      database: {
        disconnect: async () => {
          calls.push('database.disconnect');
        },
      },
      exit: ((code: number) => {
        calls.push(`exit.${code}`);
        throw new Error('exit');
      }) as never,
      timeoutMs: 100,
    });

    await assert.rejects(async () => await shutdown('SIGTERM'), /exit/);
    await shutdown('SIGINT');

    assert.deepStrictEqual(calls, [
      'client.disconnect',
      'browser.close',
      'database.disconnect',
      'exit.0',
    ]);
  });
});
