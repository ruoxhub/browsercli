/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {BreakpointManager} from '../../../../src/modules/debugger/BreakpointManager.js';
import type {BreakpointHitEvent} from '../../../../src/types/index.js';

interface MockSession {
  send: (method: string, params?: unknown) => Promise<unknown>;
}

function makeSession(
  sendImpl: (method: string, params?: unknown) => unknown = () => ({}),
): MockSession & {calls: Array<{method: string; params?: unknown}>} {
  const calls: Array<{method: string; params?: unknown}> = [];
  return {
    calls,
    async send(method: string, params?: unknown) {
      calls.push({method, params});
      return sendImpl(method, params);
    },
  };
}

describe('BreakpointManager', () => {
  it('setBreakpointByUrl validates input and calls CDP with correct params', async () => {
    const session = makeSession(() => ({
      breakpointId: 'bp-1',
      locations: [],
    }));
    const mgr = new BreakpointManager(() => session as any);

    const bp = await mgr.setBreakpointByUrl({
      url: 'https://example.com/script.js',
      lineNumber: 42,
      columnNumber: 5,
      condition: 'x > 0',
    });

    assert.strictEqual(bp.breakpointId, 'bp-1');
    assert.strictEqual(bp.location.url, 'https://example.com/script.js');
    assert.strictEqual(bp.location.lineNumber, 42);
    assert.strictEqual(bp.condition, 'x > 0');
    assert.strictEqual(bp.enabled, true);
    assert.strictEqual(bp.hitCount, 0);

    assert.strictEqual(session.calls[0].method, 'Debugger.setBreakpointByUrl');
    assert.deepStrictEqual(session.calls[0].params, {
      url: 'https://example.com/script.js',
      lineNumber: 42,
      columnNumber: 5,
      condition: 'x > 0',
    });
  });

  it('setBreakpointByUrl rejects invalid parameters', async () => {
    const session = makeSession();
    const mgr = new BreakpointManager(() => session as any);

    await assert.rejects(
      () => mgr.setBreakpointByUrl({url: '', lineNumber: 0}),
      /url parameter is required/,
    );
    await assert.rejects(
      () => mgr.setBreakpointByUrl({url: 'https://x.com', lineNumber: -1}),
      /lineNumber must be a non-negative number/,
    );
    await assert.rejects(
      () =>
        mgr.setBreakpointByUrl({
          url: 'https://x.com',
          lineNumber: 0,
          columnNumber: -3,
        }),
      /columnNumber must be a non-negative number/,
    );
    assert.strictEqual(session.calls.length, 0);
  });

  it('removeBreakpoint throws when breakpoint is not registered', async () => {
    const session = makeSession();
    const mgr = new BreakpointManager(() => session as any);

    await assert.rejects(
      () => mgr.removeBreakpoint('unknown-bp'),
      /Breakpoint not found: unknown-bp/,
    );
  });

  it('setPauseOnExceptions updates state retrievable via getPauseOnExceptionsState', async () => {
    const session = makeSession();
    const mgr = new BreakpointManager(() => session as any);

    assert.strictEqual(mgr.getPauseOnExceptionsState(), 'none');
    await mgr.setPauseOnExceptions('all');
    assert.strictEqual(mgr.getPauseOnExceptionsState(), 'all');
    assert.strictEqual(
      session.calls[0].method,
      'Debugger.setPauseOnExceptions',
    );
    assert.deepStrictEqual(session.calls[0].params, {state: 'all'});
  });

  it('breakpoint hit callbacks are invoked with the constructed event', async () => {
    const session = makeSession();
    const mgr = new BreakpointManager(() => session as any);

    let received: BreakpointHitEvent | null = null;
    mgr.onBreakpointHit(event => {
      received = event;
    });
    assert.strictEqual(mgr.getBreakpointHitCallbackCount(), 1);
    assert.strictEqual(mgr.hasBreakpointHitCallbacks(), true);

    const event: BreakpointHitEvent = {
      breakpointId: 'bp-1',
      location: {scriptId: 's1', lineNumber: 1, columnNumber: 0},
      callFrames: [],
      timestamp: Date.now(),
      reason: 'debugCommand',
    };
    await mgr.notifyBreakpointHitCallbacks(event);

    assert.ok(received !== null);
    assert.strictEqual(received!.breakpointId, 'bp-1');

    mgr.clearBreakpointHitCallbacks();
    assert.strictEqual(mgr.getBreakpointHitCallbackCount(), 0);
    assert.strictEqual(mgr.hasBreakpointHitCallbacks(), false);
  });

  it('incrementHitCounts increases hitCount for registered breakpoints', async () => {
    const session = makeSession(() => ({
      breakpointId: 'bp-1',
      locations: [],
    }));
    const mgr = new BreakpointManager(() => session as any);

    await mgr.setBreakpointByUrl({url: 'https://x.com', lineNumber: 1});
    assert.strictEqual(mgr.getBreakpoint('bp-1')!.hitCount, 0);

    mgr.incrementHitCounts(['bp-1', 'unknown-bp']);
    assert.strictEqual(mgr.getBreakpoint('bp-1')!.hitCount, 1);

    mgr.incrementHitCounts(undefined);
    assert.strictEqual(mgr.getBreakpoint('bp-1')!.hitCount, 1);
  });
});
