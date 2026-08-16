/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {createGracefulShutdown} from '../../../src/worker/WorkerLifecycle.js';

describe('WorkerLifecycle', () => {
  it('disconnects client, closes browser, then exits once', async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      browserManager: {
        close: async () => {
          calls.push('browser.close');
        },
      } as never,
      exit: ((code: number) => {
        calls.push(`exit.${code}`);
        throw new Error('exit');
      }) as never,
      timeoutMs: 100,
    });

    await assert.rejects(async () => await shutdown('SIGTERM'), /exit/);
    await shutdown('SIGINT');

    assert.deepStrictEqual(calls, ['browser.close', 'exit.0']);
  });

  it('在关闭浏览器前 await contextProvider.dispose()', async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      browserManager: {
        close: async () => {
          calls.push('browser.close');
        },
      } as never,
      contextProvider: {
        dispose: async () => {
          calls.push('ctx.dispose');
        },
      },
      exit: ((code: number) => {
        calls.push(`exit.${code}`);
        throw new Error('exit');
      }) as never,
      timeoutMs: 100,
    });

    await assert.rejects(async () => await shutdown('SIGTERM'), /exit/);

    assert.deepStrictEqual(calls, ['ctx.dispose', 'browser.close', 'exit.0']);
  });

  it('contextProvider.dispose() 超时/失败时仍继续关闭流程', async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      browserManager: {
        close: async () => {
          calls.push('browser.close');
        },
      } as never,
      contextProvider: {
        dispose: async () => {
          // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
          await new Promise(() => {}); // 永不 resolve，触发超时
        },
      },
      exit: ((code: number) => {
        calls.push(`exit.${code}`);
        throw new Error('exit');
      }) as never,
      timeoutMs: 10,
    });

    await assert.rejects(async () => await shutdown('SIGTERM'), /exit/);

    assert.deepStrictEqual(calls, ['browser.close', 'exit.0']);
  });
});
