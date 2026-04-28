/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {AxiError} from 'axi-sdk-js';

import {toolDispatcherCommand} from '../../../src/cli/commands/tool-dispatcher.js';
import {validateToolArgs} from '../../../src/cli/tool-arg-validator.js';
import type {WorkerContext} from '../../../src/cli/types.js';

interface InvokeCall {
  group: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

function createWorkerContext() {
  const calls: InvokeCall[] = [];
  const ctx = {
    sekiroHost: 'http://localhost:5612',
    group: 'test-group',
    invoker: {
      async invoke(
        group: string,
        toolName: string,
        toolArgs: Record<string, unknown> = {},
      ) {
        calls.push({group, toolName, toolArgs});
        return {ok: true};
      },
    },
    workerManager: {} as WorkerContext['workerManager'],
    resolvedConfig: {} as WorkerContext['resolvedConfig'],
    config: {},
  } as WorkerContext;

  return {calls, ctx};
}

describe('tool-arg-validator', () => {
  it('rejects unsupported params before invocation', () => {
    const result = validateToolArgs('scroll_by', {
      direction: 'down',
      pixels: 500,
      foo: 'x',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: '不支持参数 --foo；scroll_by 支持参数：direction, pixels',
    });
  });

  it('injects defaults for evaluate_script', () => {
    const result = validateToolArgs('evaluate_script', {
      function: '() => 1',
    });

    assert.deepStrictEqual(result, {
      ok: true,
      value: {
        function: '() => 1',
        context: 'page',
        verbose: false,
      },
    });
  });

  it('rejects invalid evaluate_script context enum', () => {
    const result = validateToolArgs('evaluate_script', {
      function: '() => 1',
      context: 'worker',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: 'evaluate_script 的参数 context 仅支持：page, content-script',
    });
  });

  it('injects wasm_disassemble defaults', () => {
    const result = validateToolArgs('wasm_disassemble', {
      inputPath: 'artifacts/wasm/sample.wasm',
    });

    assert.deepStrictEqual(result, {
      ok: true,
      value: {
        inputPath: 'artifacts/wasm/sample.wasm',
        foldExprs: true,
      },
    });
  });

  it('rejects invalid wasm runtime enum', () => {
    const result = validateToolArgs('wasm_offline_run', {
      inputPath: 'artifacts/wasm/sample.wasm',
      functionName: '_sign',
      runtime: 'node',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: 'wasm_offline_run 的参数 runtime 仅支持：wasmtime, wasmer, auto',
    });
  });

  it('rejects non-finite numbers', () => {
    const result = validateToolArgs('scroll_by', {
      direction: 'down',
      pixels: Number.POSITIVE_INFINITY,
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: 'scroll_by 的参数 pixels 必须是数字',
    });
  });
});

describe('tool-dispatcher', () => {
  it('rejects unsupported params before runtime invocation', async () => {
    const {calls, ctx} = createWorkerContext();

    await assert.rejects(
      Promise.resolve(
        toolDispatcherCommand(
          ['scroll_by', '--direction', 'down', '--pixels', '500', '--foo', 'x'],
          ctx,
        ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AxiError);
        assert.strictEqual(error.code, 'VALIDATION_ERROR');
        assert.strictEqual(
          error.message,
          '不支持参数 --foo；scroll_by 支持参数：direction, pixels',
        );
        assert.deepStrictEqual(calls, []);
        return true;
      },
    );
  });

  it('injects evaluate_script defaults before invoking worker', async () => {
    const {calls, ctx} = createWorkerContext();

    await toolDispatcherCommand(
      ['evaluate_script', '--function', '() => 1'],
      ctx,
    );

    assert.deepStrictEqual(calls, [
      {
        group: 'test-group',
        toolName: 'evaluate_script',
        toolArgs: {
          function: '() => 1',
          context: 'page',
          verbose: false,
        },
      },
    ]);
  });

  it('preserves explicit evaluate_script context and verbose flags', async () => {
    const {calls, ctx} = createWorkerContext();

    await toolDispatcherCommand(
      [
        'evaluate_script',
        '--function',
        '() => 1',
        '--context',
        'content-script',
        '--verbose',
        'true',
      ],
      ctx,
    );

    assert.deepStrictEqual(calls, [
      {
        group: 'test-group',
        toolName: 'evaluate_script',
        toolArgs: {
          function: '() => 1',
          context: 'content-script',
          verbose: true,
        },
      },
    ]);
  });

  it('passes search_site_experience url flag through to worker', async () => {
    const {calls, ctx} = createWorkerContext();

    await toolDispatcherCommand(
      ['search_site_experience', '--url', 'https://www.douyin.com'],
      ctx,
    );

    assert.deepStrictEqual(calls, [
      {
        group: 'test-group',
        toolName: 'search_site_experience',
        toolArgs: {
          url: 'https://www.douyin.com',
        },
      },
    ]);
  });
});
