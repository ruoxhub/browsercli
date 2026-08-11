/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DebuggerContextProvider} from '../../../src/worker/context/DebuggerContextProvider.js';

describe('DebuggerContextProvider', () => {
  it('peek does not create a CDP session', () => {
    let newSessionCount = 0;
    const page = {
      isClosed: () => false,
      context: () => ({
        newCDPSession: async () => {
          newSessionCount += 1;
          throw new Error('peek must not create a session');
        },
      }),
      once: () => undefined,
    } as never;
    const provider = new DebuggerContextProvider();
    assert.equal(provider.getForPage(page), undefined);
    assert.equal(newSessionCount, 0);
  });

  it('enables debugger manager only once for the same page', async () => {
    const provider = new DebuggerContextProvider();
    let enabledCount = 0;
    const client = {
      on: () => undefined,
      off: () => undefined,
      send: async () => undefined,
      detach: async () => undefined,
    };
    const page = {
      isClosed: () => false,
      context: () => ({
        newCDPSession: async () => {
          enabledCount++;
          return client;
        },
      }),
      once: () => undefined,
    };

    const first = await provider.ensureForPage(page as never);
    const second = await provider.ensureForPage(page as never);

    assert.strictEqual(first, second);
    assert.strictEqual(enabledCount, 1);
  });
});
