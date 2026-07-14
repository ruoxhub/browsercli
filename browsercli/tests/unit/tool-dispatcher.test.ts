/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {AxiError} from 'axi-sdk-js';

import {toolDispatcherCommand} from '../../src/commands/tool-dispatcher.js';
import type {ToolMeta} from '../../src/tool-meta-types.js';
import type {WorkerContext} from '../../src/types.js';
import {WorkerHttpClient} from '../../src/WorkerHttpClient.js';

const SAMPLE_TOOLS: ToolMeta[] = [
  {
    name: 'my_tool',
    description: 'A sample tool',
    schema: {},
    argSpecs: {
      foo: {type: 'string', required: false, description: 'foo param'},
    },
    modulePath: './my_tool.js',
    handlerName: 'myTool',
    callMode: 'defineTool',
    domain: 'reverse',
    profile: 'full',
  },
];

class MockHttpClient extends WorkerHttpClient {
  listToolsCalls = 0;
  invokeCalls: Array<[string | undefined, string, Record<string, unknown>]> =
    [];
  openStreamCalls = 0;

  constructor(
    private readonly tools: ToolMeta[],
    private readonly result: unknown,
  ) {
    super({baseUrl: 'http://127.0.0.1:8765'});
  }

  async listTools(): Promise<{tools: unknown[]}> {
    this.listToolsCalls++;
    return {tools: this.tools};
  }

  async invoke(
    sessionId: string | undefined,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    this.invokeCalls.push([sessionId, tool, params]);
    return this.result;
  }

  async openStream(): Promise<() => void> {
    this.openStreamCalls++;
    return () => {};
  }
}

function ctxWith(client: WorkerHttpClient): WorkerContext {
  return {httpClient: client, transport: 'http'};
}

describe('tool-dispatcher (pure HTTP)', () => {
  it('throws VALIDATION_ERROR when tool name is missing', async () => {
    const client = new MockHttpClient(SAMPLE_TOOLS, {ok: true});
    await assert.rejects(
      async () => toolDispatcherCommand([], ctxWith(client)),
      (err: unknown) => {
        const e = err as AxiError;
        return (
          e instanceof AxiError &&
          e.code === 'VALIDATION_ERROR' &&
          e.message.includes('缺少工具名称')
        );
      },
    );
  });

  it('throws UNKNOWN_TOOL with suggestions for an unknown tool', async () => {
    const client = new MockHttpClient(SAMPLE_TOOLS, {ok: true});
    await assert.rejects(
      async () => toolDispatcherCommand(['nope'], ctxWith(client)),
      (err: unknown) => {
        const e = err as AxiError;
        return e instanceof AxiError && e.code === 'UNKNOWN_TOOL';
      },
    );
  });

  it('resolves dashed names to canonical snake_case and invokes over HTTP', async () => {
    const client = new MockHttpClient(SAMPLE_TOOLS, {hello: 'world'});
    const result = (await toolDispatcherCommand(
      ['my-tool', '--foo', 'bar'],
      ctxWith(client),
    )) as Record<string, unknown>;

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.command, 'call');
    assert.strictEqual(result.tool, 'my_tool');
    assert.deepStrictEqual(result.result, {hello: 'world'});

    assert.strictEqual(client.invokeCalls.length, 1);
    assert.deepStrictEqual(client.invokeCalls[0], [
      undefined,
      'my_tool',
      {foo: 'bar'},
    ]);
  });

  it('wires --session to the invoke call', async () => {
    const client = new MockHttpClient(SAMPLE_TOOLS, {done: true});
    await toolDispatcherCommand(
      ['my_tool', '--session', 'sess_abc'],
      ctxWith(client),
    );
    assert.deepStrictEqual(client.invokeCalls[0][0], 'sess_abc');
  });
});
