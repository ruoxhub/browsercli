/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ExecutionController} from '../../../../src/modules/debugger/ExecutionController.js';

function makeSession() {
  const calls: Array<{method: string; params?: unknown}> = [];
  const listeners: Record<string, Function> = {};
  return {
    calls,
    async send(method: string, params?: unknown) {
      calls.push({method, params});
      return {};
    },
    on(event: string, handler: Function) {
      listeners[event] = handler;
    },
    off(event: string) {
      delete listeners[event];
    },
  };
}

describe('ExecutionController new methods', () => {
  it('continueToLocation sends correct CDP command', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    await ctrl.continueToLocation({
      scriptId: 's1',
      lineNumber: 42,
      columnNumber: 5,
    });

    assert.strictEqual(session.calls[0].method, 'Debugger.continueToLocation');
    assert.deepStrictEqual(session.calls[0].params, {
      location: {scriptId: 's1', lineNumber: 42, columnNumber: 5},
    });
  });

  it('continueToLocation supports targetCallFrames option', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    await ctrl.continueToLocation({scriptId: 's1', lineNumber: 10}, 'current');

    assert.deepStrictEqual(session.calls[0].params, {
      location: {scriptId: 's1', lineNumber: 10},
      targetCallFrames: 'current',
    });
  });

  it('setVariableValue sends correct CDP command', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    await ctrl.setVariableValue('cf-1', 0, 'myVar', {value: 42});

    assert.strictEqual(session.calls[0].method, 'Debugger.setVariableValue');
    assert.deepStrictEqual(session.calls[0].params, {
      callFrameId: 'cf-1',
      scopeNumber: 0,
      variableName: 'myVar',
      newValue: {value: 42},
    });
  });

  it('restartFrame sends CDP command with StepInto mode', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    await ctrl.restartFrame('cf-1');

    assert.strictEqual(session.calls[0].method, 'Debugger.restartFrame');
    assert.deepStrictEqual(session.calls[0].params, {
      callFrameId: 'cf-1',
      mode: 'StepInto',
    });
  });

  it('setReturnValue sends correct CDP command', async () => {
    const session = makeSession();
    const ctrl = new ExecutionController(() => session as any);

    await ctrl.setReturnValue({value: 'overridden'});

    assert.strictEqual(session.calls[0].method, 'Debugger.setReturnValue');
    assert.deepStrictEqual(session.calls[0].params, {
      newValue: {value: 'overridden'},
    });
  });
});
