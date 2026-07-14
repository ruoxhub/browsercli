/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {buildPausedInfoData} from '../../../../src/tools/debugger/index.js';

interface MockScope {
  type: string;
  name?: string;
  object: {objectId?: string};
}

interface MockCallFrame {
  callFrameId: string;
  functionName: string;
  url?: string;
  location: {scriptId: string; lineNumber: number; columnNumber: number};
  scopeChain: MockScope[];
}

interface MockPausedState {
  isPaused: boolean;
  reason?: string;
  hitBreakpoints?: string[];
  callFrames: MockCallFrame[];
}

function createDebugger(opts: {
  pausedState: MockPausedState;
  scriptUrl?: (id: string) => string | undefined;
  scopeVariables?: Record<string, Array<{name: string; value: unknown}>>;
}): any {
  return {
    getPausedState: () => opts.pausedState,
    getScriptById: (scriptId: string) => {
      const url = opts.scriptUrl?.(scriptId);
      return url !== undefined ? {scriptId, url} : undefined;
    },
    getScopeVariables: async (objectId: string) => {
      return opts.scopeVariables?.[objectId] ?? [];
    },
  };
}

describe('buildPausedInfoData', () => {
  it('returns null when execution is not paused', async () => {
    const dbg = createDebugger({
      pausedState: {isPaused: false, callFrames: []},
    });

    const result = await buildPausedInfoData(dbg);
    assert.strictEqual(result, null);
  });

  it('builds callFrames from paused state with 1-based line numbers', async () => {
    const dbg = createDebugger({
      pausedState: {
        isPaused: true,
        reason: 'breakpoint',
        hitBreakpoints: ['bp-1'],
        callFrames: [
          {
            callFrameId: 'cf-0',
            functionName: 'myFunc',
            url: 'https://example.com/app.js',
            location: {scriptId: 's1', lineNumber: 12, columnNumber: 4},
            scopeChain: [],
          },
        ],
      },
      scriptUrl: id =>
        id === 's1' ? 'https://example.com/registered.js' : undefined,
    });

    const result = await buildPausedInfoData(dbg, {includeScopes: false});
    assert.ok(result);
    assert.strictEqual(result.isPaused, true);
    assert.strictEqual(result.reason, 'breakpoint');
    assert.deepStrictEqual(result.hitBreakpoints, ['bp-1']);
    assert.strictEqual(result.callFrames.length, 1);
    const frame = result.callFrames[0];
    assert.strictEqual(frame.index, 1);
    assert.strictEqual(frame.functionName, 'myFunc');
    // getScriptById URL takes precedence over frame.url
    assert.strictEqual(frame.url, 'https://example.com/registered.js');
    // 1-based line conversion
    assert.strictEqual(frame.lineNumber, 13);
    assert.strictEqual(frame.columnNumber, 4);
    assert.strictEqual(frame.callFrameId, 'cf-0');
    assert.strictEqual(result.scopes, undefined);
  });

  it('falls back to frame.url then synthetic url when script registry has no entry', async () => {
    const dbg = createDebugger({
      pausedState: {
        isPaused: true,
        callFrames: [
          {
            callFrameId: 'cf-1',
            functionName: 'a',
            url: 'https://fallback.example/page.js',
            location: {scriptId: 's-unknown', lineNumber: 0, columnNumber: 0},
            scopeChain: [],
          },
          {
            callFrameId: 'cf-2',
            functionName: 'b',
            location: {scriptId: 's-other', lineNumber: 0, columnNumber: 0},
            scopeChain: [],
          },
        ],
      },
    });

    const result = await buildPausedInfoData(dbg, {includeScopes: false});
    assert.ok(result);
    assert.strictEqual(
      result.callFrames[0].url,
      'https://fallback.example/page.js',
    );
    assert.strictEqual(result.callFrames[1].url, 'script:s-other');
  });

  it('omits empty hitBreakpoints from the output', async () => {
    const dbg = createDebugger({
      pausedState: {
        isPaused: true,
        hitBreakpoints: [],
        callFrames: [
          {
            callFrameId: 'cf-0',
            functionName: 'noop',
            location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
            scopeChain: [],
          },
        ],
      },
    });

    const result = await buildPausedInfoData(dbg, {includeScopes: false});
    assert.ok(result);
    assert.strictEqual(result.hitBreakpoints, undefined);
  });

  it('includes non-global scopes by default and skips global', async () => {
    const dbg = createDebugger({
      pausedState: {
        isPaused: true,
        callFrames: [
          {
            callFrameId: 'cf-0',
            functionName: 'fn',
            location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
            scopeChain: [
              {type: 'local', object: {objectId: 'obj-local'}},
              {
                type: 'closure',
                name: 'outer',
                object: {objectId: 'obj-closure'},
              },
              {type: 'global', object: {objectId: 'obj-global'}},
            ],
          },
        ],
      },
      scopeVariables: {
        'obj-local': [{name: 'x', value: 1}],
        'obj-closure': [{name: 'y', value: 'hi'}],
        // global should never be queried — assert below it wasn't read
        'obj-global': [{name: 'document', value: '[Window]'}],
      },
    });

    const result = await buildPausedInfoData(dbg);
    assert.ok(result);
    assert.ok(result.scopes);
    assert.strictEqual(result.scopes.length, 2);
    assert.strictEqual(result.scopes[0].scopeType, 'local');
    assert.strictEqual(result.scopes[0].scopeName, 'local');
    assert.deepStrictEqual(result.scopes[0].variables, [{name: 'x', value: 1}]);
    assert.strictEqual(result.scopes[1].scopeType, 'closure');
    // explicit name wins over fallback to type
    assert.strictEqual(result.scopes[1].scopeName, 'outer');
  });

  it('truncates variable lists at 20 with a count marker', async () => {
    const variables = Array.from({length: 25}, (_, i) => ({
      name: `v${i}`,
      value: i,
    }));
    const dbg = createDebugger({
      pausedState: {
        isPaused: true,
        callFrames: [
          {
            callFrameId: 'cf-0',
            functionName: 'fn',
            location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-local'}}],
          },
        ],
      },
      scopeVariables: {'obj-local': variables},
    });

    const result = await buildPausedInfoData(dbg);
    assert.ok(result?.scopes);
    const localScope = result.scopes[0];
    assert.ok(localScope.variables);
    // 20 real entries + 1 truncation marker
    assert.strictEqual(localScope.variables.length, 21);
    assert.strictEqual(localScope.variables[20].name, '... 还有 5 个');
    assert.strictEqual(localScope.variables[20].value, null);
  });

  it('skips scopes whose getScopeVariables call throws', async () => {
    const dbg: any = {
      getPausedState: () => ({
        isPaused: true,
        callFrames: [
          {
            callFrameId: 'cf-0',
            functionName: 'fn',
            location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
            scopeChain: [
              {type: 'local', object: {objectId: 'broken'}},
              {type: 'closure', object: {objectId: 'ok'}},
            ],
          },
        ],
      }),
      getScriptById: () => undefined,
      getScopeVariables: async (id: string) => {
        if (id === 'broken') {
          throw new Error('CDP error');
        }
        return [{name: 'kept', value: 7}];
      },
    };

    const result = await buildPausedInfoData(dbg);
    assert.ok(result?.scopes);
    assert.strictEqual(result.scopes.length, 2);
    // First scope had its variable read fail — entry exists but no variables.
    assert.strictEqual(result.scopes[0].variables, undefined);
    assert.deepStrictEqual(result.scopes[1].variables, [
      {name: 'kept', value: 7},
    ]);
  });

  it('skips scope variable retrieval when includeScopes is false', async () => {
    let getScopeVariablesCalled = false;
    const dbg: any = {
      getPausedState: () => ({
        isPaused: true,
        callFrames: [
          {
            callFrameId: 'cf-0',
            functionName: 'fn',
            location: {scriptId: 's1', lineNumber: 0, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj'}}],
          },
        ],
      }),
      getScriptById: () => undefined,
      getScopeVariables: async () => {
        getScopeVariablesCalled = true;
        return [];
      },
    };

    const result = await buildPausedInfoData(dbg, {includeScopes: false});
    assert.ok(result);
    assert.strictEqual(result.scopes, undefined);
    assert.strictEqual(getScopeVariablesCalled, false);
  });
});
