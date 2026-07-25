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

const EVALUATE_SCRIPT_TOOL: ToolMeta = {
  name: 'evaluate_script',
  description: 'Evaluate a JS function on the page',
  schema: {function: 'string', args: 'string[]'},
  argSpecs: {
    function: {type: 'string', required: true, description: 'fn'},
    args: {type: 'string[]', required: false, description: 'args'},
  },
  modulePath: './evaluate_script.js',
  handlerName: 'evaluateScript',
  callMode: 'defineTool',
  domain: 'reverse',
  profile: 'full',
};

const SELECT_PAGE_TOOL: ToolMeta = {
  name: 'select_page',
  description: 'Select a page by id',
  schema: {pageId: 'string'},
  argSpecs: {
    pageId: {type: 'string', required: true, description: 'page id'},
  },
  modulePath: './select_page.js',
  handlerName: 'selectPage',
  callMode: 'defineTool',
  domain: 'reverse',
  profile: 'full',
};

const SELECT_FRAME_TOOL: ToolMeta = {
  name: 'select_frame',
  description: 'Select a frame by id',
  schema: {frameId: 'string'},
  argSpecs: {
    frameId: {type: 'string', required: true, description: 'frame id'},
  },
  modulePath: './select_frame.js',
  handlerName: 'selectFrame',
  callMode: 'defineTool',
  domain: 'reverse',
  profile: 'full',
};

const ALL_TOOLS: ToolMeta[] = [
  ...SAMPLE_TOOLS,
  EVALUATE_SCRIPT_TOOL,
  SELECT_PAGE_TOOL,
  SELECT_FRAME_TOOL,
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

  async listTools(): Promise<{tools: ToolMeta[]}> {
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

  it('keeps a comma-containing --function as a string (no array split)', async () => {
    const client = new MockHttpClient(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '--function', '(a, b) => a + b'],
      ctxWith(client),
    );
    assert.deepStrictEqual(client.invokeCalls[0][2], {
      function: '(a, b) => a + b',
    });
  });

  it('does not convert --function "true"/"false"/"42" to boolean/number', async () => {
    const client = new MockHttpClient(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '--function', 'true'],
      ctxWith(client),
    );
    assert.strictEqual(
      typeof client.invokeCalls[0][2].function,
      'string',
      'function "true" should stay string, not boolean',
    );
    assert.strictEqual(client.invokeCalls[0][2].function, 'true');

    await toolDispatcherCommand(
      ['evaluate_script', '--function', 'false'],
      ctxWith(client),
    );
    assert.strictEqual(
      typeof client.invokeCalls[1][2].function,
      'string',
      'function "false" should stay string, not boolean',
    );

    await toolDispatcherCommand(
      ['evaluate_script', '--function', '42'],
      ctxWith(client),
    );
    assert.strictEqual(
      typeof client.invokeCalls[2][2].function,
      'string',
      'function "42" should stay string, not number',
    );
  });

  it('supports positional function: call evaluate_script "<fn>"', async () => {
    const client = new MockHttpClient(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '(a, b) => a + b'],
      ctxWith(client),
    );
    assert.deepStrictEqual(client.invokeCalls[0][2], {
      function: '(a, b) => a + b',
    });
  });

  it('still splits string[] params (e.g. --args) on commas', async () => {
    const client = new MockHttpClient(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '--function', '() => 1', '--args', 'u1,u2'],
      ctxWith(client),
    );
    assert.deepStrictEqual(client.invokeCalls[0][2], {
      function: '() => 1',
      args: ['u1', 'u2'],
    });
  });

  it('disambiguates `select` to select_page via --pageId', async () => {
    const client = new MockHttpClient(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(['select', '--pageId', '0'], ctxWith(client));
    assert.strictEqual(client.invokeCalls[0][1], 'select_page');
  });

  it('disambiguates `select` to select_frame via --frameId', async () => {
    const client = new MockHttpClient(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['select', '--frameId', 'f1'],
      ctxWith(client),
    );
    assert.strictEqual(client.invokeCalls[0][1], 'select_frame');
  });

  it('still throws UNKNOWN_TOOL when `select` has no disambiguating flag', async () => {
    const client = new MockHttpClient(ALL_TOOLS, {ok: true});
    await assert.rejects(
      async () => toolDispatcherCommand(['select'], ctxWith(client)),
      (err: unknown) => {
        const e = err as AxiError;
        return e instanceof AxiError && e.code === 'UNKNOWN_TOOL';
      },
    );
  });
});
