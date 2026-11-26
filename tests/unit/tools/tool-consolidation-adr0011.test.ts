/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import {
  DEPRECATED_HINTS,
  DEPRECATED_TOOLS,
  resolveDeprecatedToolHint,
} from '../../../src/cli/deprecatedHints.js';
import {CliError, invokeTool} from '../../../src/cli/toolInvoke.js';
import type {DebuggerManager} from '../../../src/modules/debugger/DebuggerManager.js';
import {buildPausedInfoData} from '../../../src/modules/debugger/PausedStateBuilder.js';
import {HookManager} from '../../../src/modules/hook/HookManager.js';
import {getPausedInfo, searchInSources} from '../../../src/tools/debugger.js';
import {createHook, removeHook} from '../../../src/tools/hook.js';

interface StructuredResult {
  success: boolean;
  tooltype?: string;
  data?: Record<string, unknown>;
}

function createMockResponse() {
  let content: StructuredResult | null = null;
  const lines: string[] = [];
  return {
    response: {
      appendResponseLine(line: string) {
        lines.push(line);
      },
      setStructuredContent(payload: StructuredResult) {
        content = payload;
      },
    },
    getContent: () => content,
  };
}

describe('ADR-0011: CLI deprecated tool hints', () => {
  it('resolves all 9 retired tools in both snake_case and kebab-case', () => {
    for (const [tool, replacement] of Object.entries(DEPRECATED_TOOLS)) {
      assert.equal(resolveDeprecatedToolHint(tool), replacement);
      assert.equal(
        resolveDeprecatedToolHint(tool.replaceAll('_', '-')),
        replacement,
      );
      assert.equal(DEPRECATED_HINTS[tool], replacement);
      assert.equal(DEPRECATED_HINTS[tool.replaceAll('_', '-')], replacement);
    }
  });

  it('rejects `call <deprecated_tool>` with COMMAND_DEPRECATED before connecting daemon', async () => {
    let connectCalled = false;
    await assert.rejects(
      invokeTool({
        toolName: 'step_into',
        rawFlags: {},
        connect: async () => {
          connectCalled = true;
          throw new Error('should not connect');
        },
      }),
      (err: unknown) =>
        err instanceof CliError &&
        err.code === 'COMMAND_DEPRECATED' &&
        err.message.includes('debugger_step --direction into'),
    );
    assert.equal(connectCalled, false);

    await assert.rejects(
      invokeTool({
        toolName: 'hook-function',
        rawFlags: {},
        connect: async () => {
          connectCalled = true;
          throw new Error('should not connect');
        },
      }),
      (err: unknown) =>
        err instanceof CliError &&
        err.code === 'COMMAND_DEPRECATED' &&
        err.message.includes('create_hook'),
    );
    assert.equal(connectCalled, false);
  });
});

describe('ADR-0011: Unified PageHook lifecycle (create_hook inject + reversible remove_hook)', () => {
  it('creates, injects in one step, records calls, and restores original function on remove_hook', async () => {
    const originalSign = (x: string) => `sig:${x}`;
    const logs: unknown[][] = [];
    const clearedIds: string[] = [];
    const sandbox: Record<string, unknown> = {
      console: {
        log: (...args: unknown[]) => logs.push(args),
        warn: (...args: unknown[]) => logs.push(args),
      },
      performance: {now: () => 0},
      Date,
      Error,
      Object,
      Array,
      JSON,
      String,
      Number,
      Boolean,
      RegExp,
      app: {sign: originalSign},
    };
    sandbox.window = sandbox;
    const vmCtx = vm.createContext(sandbox);

    const hookManager = new HookManager();
    const fakeFrame = {
      evaluate: async (script: string) => vm.runInContext(script, vmCtx),
    };
    const fakeContext = {
      getHookManager: () => hookManager,
      getPageHookStore: () => ({
        clear: (id: string) => clearedIds.push(id),
      }),
      getSelectedFrame: () => fakeFrame,
    };

    const createRes = createMockResponse();
    await createHook.handler(
      {
        params: {
          type: 'function',
          params: {target: 'window.app.sign'},
          hookId: 'page_sign_hook',
          inject: true,
          persistent: false,
        },
      } as Parameters<typeof createHook.handler>[0],
      createRes.response as unknown as Parameters<typeof createHook.handler>[1],
      fakeContext as unknown as Parameters<typeof createHook.handler>[2],
    );

    const created = createRes.getContent();
    assert.ok(created);
    assert.equal(created.success, true);
    assert.equal(created.data?.injected, true);
    assert.equal(created.data?.persisted, false);
    const appObj = sandbox.app as {sign: (x: string) => string};
    assert.notEqual(appObj.sign, originalSign);
    assert.equal(appObj.sign('hello'), 'sig:hello');
    const hookStore = sandbox.__hookStore as Record<string, unknown[]>;
    const mcpHooks = sandbox.__mcp_hooks__ as Record<
      string,
      {restore?: () => void}
    >;
    assert.equal(hookStore.page_sign_hook.length, 1);
    assert.ok(mcpHooks.page_sign_hook);
    assert.equal(typeof mcpHooks.page_sign_hook.restore, 'function');

    const removeRes = createMockResponse();
    await removeHook.handler(
      {params: {hookId: 'page_sign_hook', cleanBrowser: true}} as Parameters<
        typeof removeHook.handler
      >[0],
      removeRes.response as unknown as Parameters<typeof removeHook.handler>[1],
      fakeContext as unknown as Parameters<typeof removeHook.handler>[2],
    );

    const removed = removeRes.getContent();
    assert.ok(removed);
    assert.equal(removed.success, true);
    assert.equal(removed.data?.restored, true);
    assert.equal(removed.data?.browserCleaned, true);
    assert.equal(appObj.sign, originalSign);
    assert.equal(mcpHooks.page_sign_hook, undefined);
    assert.equal(hookStore.page_sign_hook, undefined);
    assert.deepEqual(clearedIds, ['page_sign_hook']);
  });

  it('registers restore handles for built-in fetch/xhr/eval plugins', () => {
    const manager = new HookManager();
    for (const type of ['fetch', 'xhr', 'eval']) {
      const {script} = manager.create({type, hookId: `h_${type}`});
      assert.ok(
        script.includes('window.__mcp_hooks__'),
        `${type} plugin should register restore handle`,
      );
      assert.ok(
        script.includes('restore: function()'),
        `${type} plugin should emit restore function`,
      );
    }
  });
});

describe('ADR-0011: search_in_sources single-script exact lookup', () => {
  it('returns exact 1-based line, 0-based column, charOffset, and contextChars when scriptId is provided', async () => {
    const source = 'const a = 1;\nfunction sign(x){ return x + token + token; }';
    const fakeDebugger = {
      getScriptSource: async () => source,
      getScriptById: () => ({scriptId: '42', url: 'https://example.com/min.js'}),
      getScriptSourcePath: async () => '/tmp/42.js',
    };
    const {response, getContent} = createMockResponse();

    await searchInSources.handler(
      {
        params: {
          scriptId: '42',
          query: 'token',
          occurrence: 2,
          contextChars: 8,
          caseSensitive: true,
          isRegex: false,
          maxResults: 30,
          excludeMinified: false,
          source: 'auto',
        },
      } as Parameters<typeof searchInSources.handler>[0],
      response as unknown as Parameters<typeof searchInSources.handler>[1],
      {getDebuggerContext: async () => fakeDebugger} as unknown as Parameters<
        typeof searchInSources.handler
      >[2],
    );

    const payload = getContent();
    assert.ok(payload);
    assert.equal(payload.success, true);
    assert.equal(payload.tooltype, 'search_in_sources');
    assert.equal(payload.data?.scriptId, '42');
    assert.equal(payload.data?.lineNumber, 2);
    assert.equal(
      payload.data?.columnNumber,
      'function sign(x){ return x + token + '.length,
    );
    const ctx = payload.data?.context as {fullContext: string};
    assert.ok(ctx.fullContext.includes('【token】'));
    assert.equal((payload.data?.matches as unknown[]).length, 1);
  });
});

describe('ADR-0011: get_paused_info scopeFrames="all"', () => {
  it('expands top frame scopes by default and all frame locals when scopeFrames="all"', async () => {
    const fakeDebugger = {
      getPausedState: () => ({
        reason: 'breakpoint',
        hitBreakpoints: ['bp-1'],
        callFrames: [
          {
            callFrameId: 'cf-0',
            functionName: 'inner',
            url: 'https://example.com/app.js',
            location: {scriptId: '1', lineNumber: 9, columnNumber: 4},
            scopeChain: [{type: 'local', object: {objectId: 'obj-0'}}],
          },
          {
            callFrameId: 'cf-1',
            functionName: 'outer',
            url: 'https://example.com/app.js',
            location: {scriptId: '1', lineNumber: 2, columnNumber: 0},
            scopeChain: [{type: 'local', object: {objectId: 'obj-1'}}],
          },
        ],
      }),
      getScriptById: () => ({scriptId: '1', url: 'https://example.com/app.js'}),
      getScopeVariablesForObjectId: async (id: string) =>
        id === 'obj-0'
          ? [{name: 'x', type: 'number', value: 42}]
          : [{name: 'secret', type: 'string', value: 'abc'}],
    };

    const topOnly = await buildPausedInfoData(
      fakeDebugger as unknown as DebuggerManager,
      {
        includeScopes: true,
        scopeFrames: 'top',
      },
    );
    assert.ok(topOnly);
    assert.equal(topOnly.callFrames[0].locals, undefined);
    assert.equal(topOnly.callFrames[1].locals, undefined);

    const {response, getContent} = createMockResponse();
    await getPausedInfo.handler(
      {params: {includeScopes: true, scopeFrames: 'all'}} as Parameters<
        typeof getPausedInfo.handler
      >[0],
      response as unknown as Parameters<typeof getPausedInfo.handler>[1],
      {getDebuggerContext: async () => fakeDebugger} as unknown as Parameters<
        typeof getPausedInfo.handler
      >[2],
    );
    const allFrames = getContent();
    assert.ok(allFrames);
    assert.equal(allFrames.success, true);
    const callFrames = allFrames.data?.callFrames as Array<{
      localCount?: number;
      locals?: Array<{name: string}>;
    }>;
    assert.equal(callFrames[0].localCount, 1);
    assert.equal(callFrames[0].locals?.[0].name, 'x');
    assert.equal(callFrames[1].localCount, 1);
    assert.equal(callFrames[1].locals?.[0].name, 'secret');
  });
});
