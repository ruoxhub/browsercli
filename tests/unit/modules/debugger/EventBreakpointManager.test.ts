/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {EventBreakpointManager} from '../../../../src/modules/debugger/EventBreakpointManager.js';

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

describe('EventBreakpointManager', () => {
  it('uses getSession callback for CDP calls', async () => {
    const session = makeSession();
    const mgr = new EventBreakpointManager(() => session as any);

    await mgr.setEventListenerBreakpoint('click');

    assert.strictEqual(
      session.calls[0].method,
      'DOMDebugger.setEventListenerBreakpoint',
    );
  });

  it('incrementHitCount increments matching breakpoint', async () => {
    const session = makeSession();
    const mgr = new EventBreakpointManager(() => session as any);

    const id = await mgr.setEventListenerBreakpoint('click');
    mgr.incrementHitCount(id);
    const bp = mgr.getEventBreakpoint(id);
    assert.strictEqual(bp?.hitCount, 1);
  });
});
