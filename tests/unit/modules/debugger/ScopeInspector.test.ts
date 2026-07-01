/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ScopeInspector} from '../../../../src/modules/debugger/ScopeInspector.js';
import type {PausedState} from '../../../../src/modules/debugger/types.js';

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

function makePausedState(): PausedState {
  return {
    callFrames: [
      {
        callFrameId: 'cf-1',
        functionName: 'fn',
        location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
        url: 'https://x.com',
        scopeChain: [
          {
            type: 'local',
            object: {type: 'object', objectId: 'obj-1', className: 'Object'},
          },
        ],
        this: {},
      },
    ],
    reason: 'debugCommand',
    timestamp: Date.now(),
  };
}

describe('ScopeInspector', () => {
  it('toScopeVariableScopeType passes through known scope types', () => {
    const session = makeSession();
    const inspector = new ScopeInspector(
      () => session as any,
      () => null,
    );

    assert.strictEqual(inspector.toScopeVariableScopeType('global'), 'global');
    assert.strictEqual(inspector.toScopeVariableScopeType('local'), 'local');
    assert.strictEqual(
      inspector.toScopeVariableScopeType('closure'),
      'closure',
    );
    assert.strictEqual(inspector.toScopeVariableScopeType('module'), 'module');
  });

  it('toScopeVariableScopeType normalizes unknown types to block', () => {
    const session = makeSession();
    const inspector = new ScopeInspector(
      () => session as any,
      () => null,
    );

    assert.strictEqual(
      inspector.toScopeVariableScopeType('wasm-expression-stack'),
      'block',
    );
  });

  it('getScopeVariables throws when not in paused state', async () => {
    const session = makeSession();
    const inspector = new ScopeInspector(
      () => session as any,
      () => null,
    );

    await assert.rejects(
      () => inspector.getScopeVariables(),
      /Not in paused state/,
    );
  });

  it('getScopeVariables returns variables from scope chain', async () => {
    const session = makeSession(() => ({
      result: [
        {name: 'x', value: {value: 1, type: 'number'}, writable: true},
        {
          name: 'y',
          value: {value: 'hello', type: 'string'},
          writable: true,
        },
        {name: '__proto__', value: {type: 'object'}, writable: false},
      ],
    }));
    const paused = makePausedState();
    const inspector = new ScopeInspector(
      () => session as any,
      () => paused,
    );

    const result = await inspector.getScopeVariables();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.variables.length, 2);
    assert.strictEqual(result.variables[0].name, 'x');
    assert.strictEqual(result.variables[0].scope, 'local');
    assert.strictEqual(result.variables[1].name, 'y');
    assert.strictEqual(result.totalScopes, 1);
    assert.strictEqual(result.successfulScopes, 1);
    assert.strictEqual(session.calls[0].method, 'Runtime.getProperties');
  });

  it('getScopeVariables skips errors when skipErrors is true', async () => {
    let callCount = 0;
    const session = makeSession(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error('CDP failure');
      }
      return {result: []};
    });
    const paused: PausedState = {
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'fn',
          location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
          url: 'https://x.com',
          scopeChain: [
            {
              type: 'local',
              object: {type: 'object', objectId: 'obj-1'},
            },
            {
              type: 'global',
              object: {type: 'object', objectId: 'obj-2'},
            },
          ],
          this: {},
        },
      ],
      reason: 'debugCommand',
      timestamp: Date.now(),
    };
    const inspector = new ScopeInspector(
      () => session as any,
      () => paused,
    );

    const result = await inspector.getScopeVariables({skipErrors: true});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.errors?.length, 1);
    assert.strictEqual(result.errors![0].scope, 'local');
    assert.strictEqual(result.successfulScopes, 1);
  });
});
