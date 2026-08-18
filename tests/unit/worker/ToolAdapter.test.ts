/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it, mock} from 'node:test';

import {BrowserManager} from '../../../src/modules/browser/index.js';
import {ensureToolsMeta, getToolMeta} from '../../../src/tools/tools-meta.js';
import type {ToolMeta} from '../../../src/tools/tools-meta.js';
import type {RpcRequest} from '../../../src/types/rpc.js';
import {ErrorCodes, ToolError} from '../../../src/utils/errors.js';
import {connectBrowser} from '../../../src/worker/BrowserConnectionManager.js';
import {ToolAdapter} from '../../../src/worker/ToolAdapter.js';
import {ToolContextProvider} from '../../../src/worker/ToolContext.js';
import {workerActivityCoordinator} from '../../../src/worker/WorkerActivityCoordinator.js';

interface ResolvePayload {
  structuredContent?: {
    success: boolean;
    tooltype: string;
    message?: string;
    hookId?: string;
    syncedHookIds?: string[];
    data?: unknown;
  };
}

const fixtureModulePath = './test-fixtures/toolAdapterFixtures.js';

function fixtureMeta(
  overrides: Partial<ToolMeta> & Pick<ToolMeta, 'name' | 'handlerName'>,
): ToolMeta {
  return {
    description: '',
    schema: {},
    argSpecs: {},
    modulePath: fixtureModulePath,
    callMode: 'defineTool',
    ...overrides,
  } as ToolMeta;
}

function legacyFixtureMeta(
  overrides: Partial<ToolMeta> & Pick<ToolMeta, 'name' | 'handlerName'>,
): ToolMeta {
  return fixtureMeta(overrides);
}

async function invokeTool(
  adapter: ToolAdapter,
  meta: ToolMeta,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    void adapter.wrapTool(meta)(
      {
        __sekiro_seq__: 'test',
        action: meta.name,
        params,
      } satisfies RpcRequest,
      resolve,
      reject,
    );
  });
}

describe('ToolAdapter', () => {
  it('keeps browser lifecycle changes out while a wrapped tool is running', async () => {
    let releaseTool!: () => void;
    const toolGate = new Promise<void>(resolve => {
      releaseTool = resolve;
    });
    let toolStarted!: () => void;
    const started = new Promise<void>(resolve => {
      toolStarted = resolve;
    });
    const provider = new ToolContextProvider();
    provider.setSelectedFrame({
      async evaluate() {
        toolStarted();
        await toolGate;
        return 'done';
      },
    } as never);
    const adapter = new ToolAdapter(provider);
    const meta = legacyFixtureMeta({
      name: 'frame_function_fixture',
      handlerName: 'frameFunctionFixture',
      callMode: 'frame' as ToolMeta['callMode'],
    });
    const reset = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const getInstance = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        throw new Error('browser lifecycle reached');
      },
      getContext: () => null,
    }));
    const running = invokeTool(adapter, meta);
    await started;

    try {
      await assert.rejects(
        connectBrowser(provider, {channel: 'stable'}),
        (error: unknown) => (error as {code?: string}).code === 'WORKER_BUSY',
      );
      assert.equal(reset.mock.callCount(), 0);
    } finally {
      releaseTool();
      await running;
      reset.mock.restore();
      getInstance.mock.restore();
    }
  });

  it('propagates aborts and releases the browser lifecycle guard', async () => {
    let releaseTool!: () => void;
    const toolGate = new Promise<void>(resolve => {
      releaseTool = resolve;
    });
    let toolStarted!: () => void;
    const started = new Promise<void>(resolve => {
      toolStarted = resolve;
    });
    const provider = new ToolContextProvider();
    provider.setSelectedFrame({
      async evaluate() {
        toolStarted();
        await toolGate;
        return 'late result';
      },
    } as never);
    const adapter = new ToolAdapter(provider);
    const meta = legacyFixtureMeta({
      name: 'frame_function_fixture',
      handlerName: 'frameFunctionFixture',
      callMode: 'frame' as ToolMeta['callMode'],
    });
    const controller = new AbortController();
    const reason = new Error('job cancelled');
    const executeTool = adapter.executeTool.bind(adapter) as (
      meta: ToolMeta,
      params: Record<string, unknown>,
      sessionId?: string,
      signal?: AbortSignal,
    ) => Promise<unknown>;
    const running = executeTool(meta, {}, undefined, controller.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await started;

    try {
      controller.abort(reason);
      await assert.rejects(
        Promise.race([
          running,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('abort was not propagated')),
              50,
            );
          }),
        ]),
        error => error === reason,
      );
      assert.equal(workerActivityCoordinator.getState().activeTools, 0);
    } finally {
      if (timer) clearTimeout(timer);
      releaseTool();
      await running.catch(() => undefined);
    }
  });

  it('wrapTool executes default function handlers with validated params', async () => {
    const provider = new ToolContextProvider();
    const adapter = new ToolAdapter(provider);
    const meta = legacyFixtureMeta({
      name: 'default_function_fixture',
      handlerName: 'defaultFunctionFixture',
      callMode: undefined,
      argSpecs: {
        value: {type: 'string', required: true, description: ''},
      },
    });

    const result = await invokeTool(adapter, meta, {value: 'ok'});

    assert.deepStrictEqual(result, {
      structuredContent: {
        received: {value: 'ok'},
        tooltype: 'default_function_fixture',
      },
    });
  });

  it('wrapTool executes context handlers with ToolContextProvider', async () => {
    const provider = new ToolContextProvider();
    const adapter = new ToolAdapter(provider);
    const meta = legacyFixtureMeta({
      name: 'context_function_fixture',
      handlerName: 'contextFunctionFixture',
      callMode: 'context' as ToolMeta['callMode'],
    });

    const result = await invokeTool(adapter, meta, {value: 'ok'});

    assert.deepStrictEqual(result, {
      structuredContent: {
        sameProvider: true,
        received: {value: 'ok'},
        tooltype: 'context_function_fixture',
      },
    });
  });

  it('wrapTool executes frame handlers with selected frame', async () => {
    const provider = new ToolContextProvider();
    const frame = {
      evaluate: async (script: string) => `evaluated:${script}`,
    };
    provider.setSelectedFrame(frame as never);
    const adapter = new ToolAdapter(provider);
    const meta = legacyFixtureMeta({
      name: 'frame_function_fixture',
      handlerName: 'frameFunctionFixture',
      callMode: 'frame' as ToolMeta['callMode'],
    });

    const result = await invokeTool(adapter, meta, {value: 'ok'});

    assert.deepStrictEqual(result, {
      structuredContent: {
        evaluated: 'evaluated:window.__fixtureValue',
        received: {value: 'ok'},
        tooltype: 'frame_function_fixture',
      },
    });
  });

  it('wrapTool executes defineTool handlers with accumulated response', async () => {
    const provider = new ToolContextProvider();
    provider.setPages([
      {mainFrame: () => ({}), isClosed: () => false} as never,
    ]);
    const adapter = new ToolAdapter(provider);
    const meta = fixtureMeta({
      name: 'define_tool_fixture',
      handlerName: 'defineToolFixture',
      callMode: 'defineTool',
    });

    const result = await invokeTool(adapter, meta, {value: 'ok'});

    assert.deepStrictEqual(result, {
      structuredContent: {
        selectedPageAvailable: true,
        received: {value: 'ok'},
        tooltype: 'define_tool_fixture',
      },
    });
  });

  it('wrapTool rejects validation errors as ToolError VALIDATION', async () => {
    await ensureToolsMeta();
    const provider = new ToolContextProvider();
    const adapter = new ToolAdapter(provider);
    const meta = getToolMeta('recommend_next_step');
    assert.ok(meta, 'missing meta for recommend_next_step');

    await assert.rejects(
      invokeTool(adapter, meta, {currentStage: 'INVALID'}),
      (error: unknown) =>
        error instanceof ToolError && error.code === ErrorCodes.VALIDATION,
    );
  });

  it('wrapTool rejects missing handlers as ToolError NOT_FOUND', async () => {
    const provider = new ToolContextProvider();
    const adapter = new ToolAdapter(provider);
    const meta = fixtureMeta({
      name: 'missing_handler_fixture',
      handlerName: 'missingHandlerFixture',
    });

    await assert.rejects(
      invokeTool(adapter, meta),
      (error: unknown) =>
        error instanceof ToolError && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('wrapTool emits tool:error for thrown errors', async () => {
    const provider = new ToolContextProvider();
    const events: Array<{
      name: string;
      code: string;
      message: string;
      traceId: string;
    }> = [];
    provider.eventBus.on('tool:error', payload => {
      events.push(payload);
    });
    const adapter = new ToolAdapter(provider);
    const meta = fixtureMeta({
      name: 'throwing_fixture',
      handlerName: 'throwingFixture',
      callMode: undefined,
    });

    await assert.rejects(
      invokeTool(adapter, meta),
      (error: unknown) =>
        error instanceof ToolError && error.code === ErrorCodes.RUNTIME,
    );

    assert.strictEqual(events.length, 1);
    assert.deepStrictEqual(
      {
        name: events[0]!.name,
        code: events[0]!.code,
        message: events[0]!.message,
      },
      {
        name: 'throwing_fixture',
        code: ErrorCodes.RUNTIME,
        message: 'fixture failure',
      },
    );
    assert.match(events[0]!.traceId, /^tr_/);
  });

  it('passes params objects through params-only workflow tools', async () => {
    const runtime = new ToolContextProvider();
    const adapter = new ToolAdapter(runtime);
    const meta = getToolMeta('explain_reverse_stage');
    assert.ok(meta, 'missing meta for explain_reverse_stage');

    const result = await new Promise<ResolvePayload>((resolve, reject) => {
      void adapter.wrapTool(meta!)(
        {
          __sekiro_seq__: 'test',
          action: meta!.name,
          params: {stage: 'Observe'},
        },
        value => resolve(value as ResolvePayload),
        reject,
      );
    });

    assert.strictEqual(result.structuredContent?.success, true);
    assert.strictEqual(
      result.structuredContent?.tooltype,
      'explain_reverse_stage',
    );
    assert.strictEqual(
      result.structuredContent?.message,
      '逆向阶段说明: Observe',
    );
    assert.strictEqual(
      (result.structuredContent?.data as {stage?: string})?.stage,
      'Observe',
    );
  });

  it('passes params objects through frame callMode hook management tools', async () => {
    const runtime = new ToolContextProvider();
    const evaluateCalls: Array<{
      kind: 'reader' | 'cleanup';
      hookId?: string;
      script?: string;
    }> = [];
    const frame = {
      evaluate: async (arg: unknown, hookId?: string) => {
        if (typeof arg === 'function') {
          evaluateCalls.push({kind: 'reader', hookId});
          return {
            [hookId || 'all']: [{event: 'call', target: 'window.fetch'}],
          };
        }

        evaluateCalls.push({kind: 'cleanup', script: String(arg)});
        return undefined;
      },
    };
    const page = {
      mainFrame: () => frame,
      isClosed: () => false,
    };

    runtime.setPages([page as never]);
    runtime.setSelectedPage(page as never);

    const adapter = new ToolAdapter(runtime);
    const runTool = async (
      toolName: 'get_hook_data' | 'list_created_hooks' | 'remove_hook',
    ): Promise<ResolvePayload> => {
      const meta = getToolMeta(toolName);
      assert.ok(meta, `missing meta for ${toolName}`);

      return await new Promise<ResolvePayload>((resolve, reject) => {
        void adapter.wrapTool(meta!)(
          {
            __sekiro_seq__: 'test',
            action: meta!.name,
            params: {hookId: 'hook_from_params'},
          },
          value => resolve(value as ResolvePayload),
          reject,
        );
      });
    };

    const getResult = await runTool('get_hook_data');
    const listResult = await runTool('list_created_hooks');
    const removeResult = await runTool('remove_hook');

    assert.deepStrictEqual(getResult.structuredContent, {
      success: true,
      message: '已获取 Hook hook_from_params 的数据',
      tooltype: 'get_hook_data',
      data: {
        hook_from_params: [{event: 'call', target: 'window.fetch'}],
      },
    });

    assert.deepStrictEqual(listResult.structuredContent, {
      success: true,
      message: '共 1 个 Hook',
      tooltype: 'list_created_hooks',
      syncedHookIds: ['hook_from_params'],
      totalRecords: 1,
      hooks: [
        {
          hookId: 'hook_from_params',
          source: 'manager',
          type: 'unknown',
          description: '',
          enabled: true,
          callCount: 1,
          recordCount: 1,
        },
      ],
      data: {
        totalHooks: 1,
        totalEnabled: 1,
        totalDisabled: 0,
        totalRecords: 1,
        hooks: [
          {
            hookId: 'hook_from_params',
            source: 'manager',
            type: 'unknown',
            description: '',
            enabled: true,
            callCount: 1,
            recordCount: 1,
          },
        ],
      },
    });

    assert.deepStrictEqual(removeResult.structuredContent, {
      success: true,
      message: '浏览器端 Hook 数据已清理：hook_from_params',
      tooltype: 'remove_hook',
      hookId: 'hook_from_params',
    });

    const readerHookIds = evaluateCalls
      .filter(call => call.kind === 'reader')
      .map(call => call.hookId);
    assert.deepStrictEqual(readerHookIds, ['hook_from_params']);

    const cleanupCall = evaluateCalls.find(call => call.kind === 'cleanup');
    assert.ok(cleanupCall?.script?.includes('window.__hookStore'));
    assert.ok(cleanupCall?.script?.includes('"hook_from_params"'));
  });

  it('onInvoke bridges tool:called and tool:error into ToolInvokeEvent', async () => {
    const provider = new ToolContextProvider();
    const adapter = new ToolAdapter(provider);
    const events: Array<{
      traceId: string;
      toolName: string;
      phase: 'end';
      ts: number;
      durationMs?: number;
      success: boolean;
      error?: {code: string; message: string};
    }> = [];
    const unsubscribe = adapter.onInvoke(event => {
      events.push(event);
    });

    // success path
    const successMeta = legacyFixtureMeta({
      name: 'default_function_fixture',
      handlerName: 'defaultFunctionFixture',
      callMode: undefined,
      argSpecs: {
        value: {type: 'string', required: true, description: ''},
      },
    });
    await invokeTool(adapter, successMeta, {value: 'ok'});

    // failure path
    const failureMeta = fixtureMeta({
      name: 'throwing_fixture',
      handlerName: 'throwingFixture',
      callMode: undefined,
    });
    await assert.rejects(
      invokeTool(adapter, failureMeta),
      (error: unknown) =>
        error instanceof ToolError && error.code === ErrorCodes.RUNTIME,
    );

    assert.strictEqual(events.length, 2);

    const success = events[0]!;
    assert.strictEqual(success.toolName, 'default_function_fixture');
    assert.strictEqual(success.phase, 'end');
    assert.strictEqual(success.success, true);
    assert.match(success.traceId, /^tr_/);
    assert.strictEqual(typeof success.durationMs, 'number');
    assert.strictEqual(success.error, undefined);

    const failure = events[1]!;
    assert.strictEqual(failure.toolName, 'throwing_fixture');
    assert.strictEqual(failure.phase, 'end');
    assert.strictEqual(failure.success, false);
    assert.match(failure.traceId, /^tr_/);
    assert.deepStrictEqual(failure.error, {
      code: ErrorCodes.RUNTIME,
      message: 'fixture failure',
    });

    // unsubscribe stops further events
    unsubscribe();
    await invokeTool(adapter, successMeta, {value: 'after-unsub'});
    assert.strictEqual(events.length, 2);
  });
});
