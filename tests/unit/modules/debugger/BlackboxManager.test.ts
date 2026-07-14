/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {BlackboxManager} from '../../../../src/modules/debugger/BlackboxManager.js';

function makeSession() {
  const calls: Array<{method: string; params?: unknown}> = [];
  return {
    calls,
    async send(method: string, params?: unknown) {
      calls.push({method, params});
      return {};
    },
  };
}

describe('BlackboxManager', () => {
  it('uses getSession callback for CDP calls', async () => {
    const session = makeSession();
    const mgr = new BlackboxManager(() => session as any);

    await mgr.blackboxByPattern('.*jquery.*');

    assert.strictEqual(session.calls[0].method, 'Debugger.setBlackboxPatterns');
  });

  it('setBlackboxedRanges sends correct CDP command', async () => {
    const session = makeSession();
    const mgr = new BlackboxManager(() => session as any);

    await mgr.setBlackboxedRanges('s1', [
      {lineNumber: 0, columnNumber: 0},
      {lineNumber: 50, columnNumber: 0},
    ]);

    assert.strictEqual(session.calls[0].method, 'Debugger.setBlackboxedRanges');
    assert.deepStrictEqual(session.calls[0].params, {
      scriptId: 's1',
      positions: [
        {lineNumber: 0, columnNumber: 0},
        {lineNumber: 50, columnNumber: 0},
      ],
    });
  });
});
