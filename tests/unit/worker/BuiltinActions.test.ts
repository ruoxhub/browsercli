/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {ActionHandler} from '../../../src/types/rpc.js';
import {registerBuiltinActions} from '../../../src/worker/BuiltinActions.js';

describe('BuiltinActions', () => {
  it('registers list tools and status actions', async () => {
    const actions = new Map<string, ActionHandler>();
    const client = {
      getStatus: () => ({isConnected: true}),
      registerAction: (name: string, handler: ActionHandler) => {
        actions.set(name, handler);
      },
    };

    registerBuiltinActions(client);

    assert.deepStrictEqual(Array.from(actions.keys()), [
      '_list_tools',
      '_status',
    ]);

    const status = await new Promise<unknown>((resolve, reject) => {
      actions.get('_status')?.({} as never, resolve, reject);
    });
    assert.ok(
      typeof status === 'object' && status !== null,
      'status payload should be an object',
    );
    assert.strictEqual((status as {pid: number}).pid, process.pid);
    assert.deepStrictEqual((status as {status: unknown}).status, {
      isConnected: true,
    });
    assert.strictEqual(typeof (status as {uptime: unknown}).uptime, 'number');

    const listTools = await new Promise<{tools: Array<{name: string}>}>(
      (resolve, reject) => {
        void actions.get('_list_tools')?.(
          {} as never,
          value => {
            resolve(value as {tools: Array<{name: string}>});
          },
          reject,
        );
      },
    );
    assert.ok(listTools.tools.some(tool => tool.name === 'navigate_page'));
  });
});
