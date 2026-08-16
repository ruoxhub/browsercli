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
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
}

function makeSession(
  sendImpl: (method: string, params?: unknown) => unknown = () => ({}),
): MockSession & {
  calls: Array<{method: string; params?: unknown}>;
  listeners: Record<string, (...args: unknown[]) => void>;
} {
  const calls: Array<{method: string; params?: unknown}> = [];
  const listeners: Record<string, () => void> = {};
  return {
    calls,
    listeners,
    async send(method: string, params?: unknown) {
      calls.push({method, params});
      return sendImpl(method, params);
    },
    on(event: string, handler: () => void) {
      listeners[event] = handler;
    },
    off(event: string) {
      delete listeners[event];
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

  it('stores locations resolved by CDP for URL breakpoints', async () => {
    const session = makeSession(() => ({
      breakpointId: 'bp-url-resolved',
      locations: [{scriptId: 'script-1', lineNumber: 43, columnNumber: 18}],
    }));
    const mgr = new BreakpointManager(() => session as any);

    const bp = await mgr.setBreakpointByUrl({
      url: 'https://example.com/script.js',
      lineNumber: 42,
    });

    assert.deepStrictEqual(bp.resolvedLocations, [
      {scriptId: 'script-1', lineNumber: 43, columnNumber: 18},
    ]);
    assert.deepStrictEqual(bp.requestedLocation, {
      url: 'https://example.com/script.js',
      lineNumber: 42,
      columnNumber: undefined,
    });
  });

  it('stores the actual location returned for script breakpoints', async () => {
    const session = makeSession(() => ({
      breakpointId: 'bp-script-resolved',
      actualLocation: {scriptId: 'script-1', lineNumber: 8, columnNumber: 12},
    }));
    const mgr = new BreakpointManager(() => session as any);

    const bp = await mgr.setBreakpoint({
      scriptId: 'script-1',
      lineNumber: 7,
      columnNumber: 0,
    });

    assert.deepStrictEqual(bp.resolvedLocations, [
      {scriptId: 'script-1', lineNumber: 8, columnNumber: 12},
    ]);
    assert.deepStrictEqual(bp.requestedLocation, {
      scriptId: 'script-1',
      lineNumber: 7,
      columnNumber: 0,
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

  it('setBreakpointOnFunctionCall calls CDP and stores breakpoint', async () => {
    const session = makeSession(() => ({breakpointId: 'fn-bp-1'}));
    const mgr = new BreakpointManager(() => session as any);

    const bp = await mgr.setBreakpointOnFunctionCall('obj-123', 'x > 5');

    assert.strictEqual(bp.breakpointId, 'fn-bp-1');
    assert.strictEqual(bp.condition, 'x > 5');
    assert.strictEqual(bp.enabled, true);
    assert.strictEqual(
      session.calls[0].method,
      'Debugger.setBreakpointOnFunctionCall',
    );
    assert.deepStrictEqual(session.calls[0].params, {
      objectId: 'obj-123',
      condition: 'x > 5',
    });
  });

  it('getPossibleBreakpoints returns break locations from CDP', async () => {
    const session = makeSession(() => ({
      locations: [
        {scriptId: 's1', lineNumber: 10, columnNumber: 0, type: 'call'},
        {scriptId: 's1', lineNumber: 11, columnNumber: 4},
      ],
    }));
    const mgr = new BreakpointManager(() => session as any);

    const result = await mgr.getPossibleBreakpoints({
      scriptId: 's1',
      lineNumber: 10,
    });

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].type, 'call');
    assert.strictEqual(
      session.calls[0].method,
      'Debugger.getPossibleBreakpoints',
    );
  });

  it('handleBreakpointResolved updates breakpoint location', async () => {
    const session = makeSession(() => ({breakpointId: 'bp-r', locations: []}));
    const mgr = new BreakpointManager(() => session as any);

    // Need to attach listeners first so breakpointResolved handler is registered
    mgr.attachListeners(session as any);

    await mgr.setBreakpointByUrl({
      url: 'https://example.com/a.js',
      lineNumber: 10,
    });
    const bpBefore = mgr.getBreakpoint('bp-r');
    assert.strictEqual(bpBefore?.location.scriptId, undefined);

    // Simulate breakpointResolved event via the listener
    const handler = session.listeners['Debugger.breakpointResolved'];
    if (handler) {
      handler({
        breakpointId: 'bp-r',
        location: {scriptId: 's99', lineNumber: 12, columnNumber: 3},
      });
    }

    const bpAfter = mgr.getBreakpoint('bp-r');
    assert.strictEqual(bpAfter?.location.scriptId, 's99');
    assert.strictEqual(bpAfter?.location.lineNumber, 12);
    assert.strictEqual(bpAfter?.location.columnNumber, 3);
  });

  it('consumes modern resolvedBreakpoints from scriptParsed', async () => {
    const session = makeSession(() => ({
      breakpointId: 'bp-modern',
      locations: [],
    }));
    const mgr = new BreakpointManager(() => session as any);
    mgr.attachListeners(session as any);

    await mgr.setBreakpointByUrl({
      url: 'https://example.com/a.js',
      lineNumber: 10,
    });
    session.listeners['Debugger.scriptParsed']?.({
      scriptId: 's100',
      url: 'https://example.com/a.js',
      startLine: 0,
      startColumn: 0,
      endLine: 20,
      endColumn: 0,
      resolvedBreakpoints: [
        {
          breakpointId: 'bp-modern',
          location: {scriptId: 's100', lineNumber: 10, columnNumber: 4},
        },
      ],
    });

    assert.deepStrictEqual(mgr.getBreakpoint('bp-modern')?.resolvedLocations, [
      {scriptId: 's100', lineNumber: 10, columnNumber: 4},
    ]);
    assert.deepStrictEqual(mgr.getBreakpointsForExport(), [
      {
        location: {
          scriptId: undefined,
          url: 'https://example.com/a.js',
          lineNumber: 10,
          columnNumber: undefined,
        },
        condition: undefined,
        enabled: true,
      },
    ]);
  });
});
