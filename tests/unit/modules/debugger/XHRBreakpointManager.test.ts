/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {XHRBreakpointManager} from '../../../../src/modules/debugger/XHRBreakpointManager.js';

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

describe('XHRBreakpointManager', () => {
  it('uses getSession callback for CDP calls', async () => {
    const session = makeSession();
    const mgr = new XHRBreakpointManager(() => session as any);

    await mgr.setXHRBreakpoint('/api/data');

    assert.strictEqual(session.calls[0].method, 'DOMDebugger.setXHRBreakpoint');
  });

  it('incrementHitCount increments matching breakpoint', async () => {
    const session = makeSession();
    const mgr = new XHRBreakpointManager(() => session as any);

    const id = await mgr.setXHRBreakpoint('/api/test');
    const bpBefore = mgr.getXHRBreakpoint(id);
    assert.strictEqual(bpBefore?.hitCount, 0);

    mgr.incrementHitCount(id);
    const bpAfter = mgr.getXHRBreakpoint(id);
    assert.strictEqual(bpAfter?.hitCount, 1);
  });

  it('incrementHitCount ignores unknown breakpoint ids', () => {
    const session = makeSession();
    const mgr = new XHRBreakpointManager(() => session as any);

    mgr.incrementHitCount('nonexistent');
  });
});
