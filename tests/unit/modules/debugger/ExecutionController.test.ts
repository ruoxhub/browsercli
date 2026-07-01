/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ExecutionController} from '../../../../src/modules/debugger/ExecutionController.js';

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

describe('ExecutionController', () => {
  it('pause / resume / stepInto / stepOver / stepOut send correct CDP commands', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    await ctrl.pause();
    await ctrl.resume();
    await ctrl.stepInto();
    await ctrl.stepOver();
    await ctrl.stepOut();

    assert.deepStrictEqual(
      session.calls.map(c => c.method),
      [
        'Debugger.pause',
        'Debugger.resume',
        'Debugger.stepInto',
        'Debugger.stepOver',
        'Debugger.stepOut',
      ],
    );
  });

  it('evaluateOnCallFrame throws when not in paused state', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    await assert.rejects(
      () =>
        ctrl.evaluateOnCallFrame({
          callFrameId: 'cf-1',
          expression: '1 + 1',
        }),
      /Not in paused state/,
    );
    assert.strictEqual(session.calls.length, 0);
  });

  it('evaluateOnCallFrame forwards params to CDP when paused', async () => {
    const session = makeSession(() => ({result: {value: 42, type: 'number'}}));
    const ctrl = new ExecutionController(() => session as any);

    // Simulate a paused event via setPausedState
    ctrl.setPausedState({
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'fn',
          location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
          url: 'https://x.com',
          scopeChain: [],
          this: {},
        },
      ],
      reason: 'debugCommand',
    });

    const result = await ctrl.evaluateOnCallFrame({
      callFrameId: 'cf-1',
      expression: '1 + 1',
    });
    assert.deepStrictEqual(result, {value: 42, type: 'number'});
    assert.strictEqual(session.calls[0].method, 'Debugger.evaluateOnCallFrame');
    assert.deepStrictEqual(session.calls[0].params, {
      callFrameId: 'cf-1',
      expression: '1 + 1',
      returnByValue: true,
    });
  });

  it('setPausedState writes state and isPaused / getPausedState reflect it', () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    assert.strictEqual(ctrl.isPaused(), false);
    assert.strictEqual(ctrl.getPausedState(), null);

    ctrl.setPausedState({
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'fn',
          location: {scriptId: 's1', lineNumber: 10, columnNumber: 0},
          url: 'https://x.com',
          scopeChain: [],
          this: {},
        },
      ],
      reason: 'debugCommand',
      hitBreakpoints: ['bp-1'],
    });

    assert.strictEqual(ctrl.isPaused(), true);
    const state = ctrl.getPausedState();
    assert.ok(state !== null);
    assert.strictEqual(state.reason, 'debugCommand');
    assert.deepStrictEqual(state.hitBreakpoints, ['bp-1']);
    assert.ok(state.timestamp > 0);
  });

  it('waitForPaused resolves immediately when already paused', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    ctrl.setPausedState({
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'fn',
          location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
          url: 'https://x.com',
          scopeChain: [],
          this: {},
        },
      ],
      reason: 'debugCommand',
    });

    const state = await ctrl.waitForPaused(100);
    assert.strictEqual(state.reason, 'debugCommand');
  });
});
