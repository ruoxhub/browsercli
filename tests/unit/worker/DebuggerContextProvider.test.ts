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
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const client = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        (listeners[event] ??= []).push(handler);
      },
      off: (event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = (listeners[event] ?? []).filter(
          listener => listener !== handler,
        );
      },
      send: async (method: string) => {
        if (method === 'Debugger.enable') {
          for (const listener of listeners['Debugger.scriptParsed'] ?? []) {
            listener({
              scriptId: 'script-at-enable',
              url: 'https://example.com/enable.js',
              startLine: 0,
              startColumn: 0,
              endLine: 1,
              endColumn: 1,
            });
          }
        }
        if (method === 'Runtime.enable') {
          for (const listener of listeners['Runtime.executionContextCreated'] ??
            []) {
            listener({
              context: {
                id: 1,
                origin: 'https://example.com',
                name: '',
                auxData: {isDefault: true, frameId: 'frame-1'},
              },
            });
          }
        }
        return undefined;
      },
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
    assert.strictEqual(first.getScripts().length, 1);
    assert.strictEqual(first.getExecutionContexts().length, 1);
  });
});
