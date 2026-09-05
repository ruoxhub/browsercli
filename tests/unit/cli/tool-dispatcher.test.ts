/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {AxiError} from 'axi-sdk-js';

import {parseArgs} from '../../../src/cli/args-parser.js';
import {buildToolArgs} from '../../../src/cli/commands/shared/tool-args.js';
import {
  BUSY_RETRY_DELAYS_MS,
  invokeWithBusyRetry,
  toolDispatcherCommand,
} from '../../../src/cli/commands/tool-dispatcher.js';
import type {DaemonEvent, DaemonLike} from '../../../src/cli/daemonClient.js';
import type {ToolMeta} from '../../../src/cli/tool-meta-types.js';
import type {WorkerContext} from '../../../src/cli/types.js';

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

class FakeDaemon implements DaemonLike {
  calls: Array<{method: string; params?: Record<string, unknown>}> = [];
  closeCalls = 0;
  eventCallbacks = 0;
  invokeError?: Error;
  busyFailures = 0;

  constructor(
    private readonly tools: ToolMeta[],
    private readonly result: unknown,
  ) {}

  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({method, params});
    if (method === 'tools.list') return {tools: this.tools} as T;
    if (method === 'subscribe')
      return {subscribed: (params?.channels as string[]) ?? []} as T;
    if (method === 'tool.invoke') {
      if (this.busyFailures > 0) {
        this.busyFailures--;
        throw new Error('[WORKER_BUSY] worker is busy');
      }
      if (this.invokeError) throw this.invokeError;
      return this.result as T;
    }
    return {} as T;
  }

  onEvent(_cb: (event: DaemonEvent) => void): () => void {
    this.eventCallbacks++;
    return () => undefined;
  }

  close(): void {
    this.closeCalls++;
  }

  methodOrder(): string[] {
    return this.calls.map(c => c.method);
  }

  invokeParams(): Record<string, unknown> | undefined {
    const call = this.calls.find(c => c.method === 'tool.invoke');
    return call?.params as Record<string, unknown> | undefined;
  }
}

function ctxWith(client: DaemonLike): WorkerContext {
  return {session: 'default', connect: async () => client};
}

describe('tool-dispatcher (daemon socket)', () => {
  it('throws VALIDATION_ERROR when tool name is missing', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {ok: true});
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

  it('throws WORKER_NOT_RUNNING when connect fails', async () => {
    const ctx: WorkerContext = {
      session: 'default',
      connect: async () => {
        throw new AxiError('Worker 未运行：boom', 'WORKER_NOT_RUNNING');
      },
    };
    await assert.rejects(
      async () => toolDispatcherCommand(['my_tool'], ctx),
      (err: unknown) =>
        err instanceof AxiError && err.code === 'WORKER_NOT_RUNNING',
    );
  });

  it('throws UNKNOWN_TOOL with suggestions for an unknown tool', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {ok: true});
    await assert.rejects(
      async () => toolDispatcherCommand(['nope'], ctxWith(client)),
      (err: unknown) => {
        const e = err as AxiError;
        return e instanceof AxiError && e.code === 'UNKNOWN_TOOL';
      },
    );
  });

  it('resolves dashed names and requests tool.invoke with {tool, params}', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {hello: 'world'});
    const result = (await toolDispatcherCommand(
      ['my-tool', '--foo', 'bar'],
      ctxWith(client),
    )) as Record<string, unknown>;

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.command, 'call');
    assert.strictEqual(result.tool, 'my_tool');
    assert.deepStrictEqual(result.result, {hello: 'world'});

    const invoke = client.calls.filter(c => c.method === 'tool.invoke');
    assert.strictEqual(invoke.length, 1);
    assert.deepStrictEqual(invoke[0].params, {
      tool: 'my_tool',
      params: {foo: 'bar'},
    });
  });

  it('throws TOOL_FAILURE when the tool structured content reports failure', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {
      structuredContent: {
        success: false,
        message: 'operation failed',
      },
    });

    await assert.rejects(
      async () => toolDispatcherCommand(['my_tool'], ctxWith(client)),
      (error: unknown) =>
        error instanceof AxiError &&
        error.code === 'TOOL_FAILURE' &&
        error.message.includes('operation failed'),
    );
  });

  it('throws TOOL_FAILURE when the MCP result sets isError', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {
      isError: true,
      content: [{type: 'text', text: 'boom'}],
    });

    await assert.rejects(
      async () => toolDispatcherCommand(['my_tool'], ctxWith(client)),
      (error: unknown) =>
        error instanceof AxiError &&
        error.code === 'TOOL_FAILURE' &&
        error.message.includes('boom'),
    );
  });

  it('does not send CLI control flags as tool params', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {done: true});
    await toolDispatcherCommand(
      ['my_tool', '--session', 'sess_abc', '--watch', '--foo', 'bar'],
      ctxWith(client),
    );

    assert.deepStrictEqual(client.invokeParams()?.params, {foo: 'bar'});
  });

  it('emits raw tool result when --json is set', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {hello: 'world'});
    const result = await toolDispatcherCommand(
      ['my_tool', '--json'],
      ctxWith(client),
    );
    assert.deepStrictEqual(result, {hello: 'world'});
  });

  it('does not send --json as a tool param', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {done: true});
    await toolDispatcherCommand(['my_tool', '--json'], ctxWith(client));
    assert.deepStrictEqual(client.invokeParams()?.params, {});
  });

  it('subscribes to the watch channels before invoking the tool', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {done: true});
    await toolDispatcherCommand(['my_tool', '--watch'], ctxWith(client));

    assert.deepStrictEqual(client.methodOrder(), [
      'tools.list',
      'subscribe',
      'tool.invoke',
    ]);
    assert.deepStrictEqual(client.calls[1].params?.channels, [
      'tool.invoke',
      'hook.event',
      'hook.sample',
      'log',
    ]);
    assert.strictEqual(client.eventCallbacks, 1);
  });

  it('closes the daemon connection when invocation fails', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {done: true});
    client.invokeError = new Error('invoke failed');

    await assert.rejects(
      async () =>
        toolDispatcherCommand(['my_tool', '--watch'], ctxWith(client)),
      /invoke failed/,
    );

    assert.strictEqual(client.closeCalls, 1);
  });

  it('closes the daemon connection on the success path too', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {done: true});
    await toolDispatcherCommand(['my_tool'], ctxWith(client));
    assert.strictEqual(client.closeCalls, 1);
  });

  it('keeps a comma-containing --function as a string (no array split)', async () => {
    const client = new FakeDaemon(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '--function', '(a, b) => a + b'],
      ctxWith(client),
    );
    assert.deepStrictEqual(client.invokeParams()?.params, {
      function: '(a, b) => a + b',
    });
  });

  it('does not convert --function "true"/"false"/"42" to boolean/number', async () => {
    const client = new FakeDaemon(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '--function', 'true'],
      ctxWith(client),
    );
    const first = client.invokeParams()?.params as Record<string, unknown>;
    assert.strictEqual(
      typeof first.function,
      'string',
      'function "true" should stay string, not boolean',
    );
    assert.strictEqual(first.function, 'true');

    await toolDispatcherCommand(
      ['evaluate_script', '--function', 'false'],
      ctxWith(client),
    );
    const second = client.invokeParams()?.params as Record<string, unknown>;
    assert.strictEqual(
      typeof second.function,
      'string',
      'function "false" should stay string, not boolean',
    );

    await toolDispatcherCommand(
      ['evaluate_script', '--function', '42'],
      ctxWith(client),
    );
    const third = client.invokeParams()?.params as Record<string, unknown>;
    assert.strictEqual(
      typeof third.function,
      'string',
      'function "42" should stay string, not number',
    );
  });

  it('supports positional function: call evaluate_script "<fn>"', async () => {
    const client = new FakeDaemon(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '(a, b) => a + b'],
      ctxWith(client),
    );
    assert.deepStrictEqual(client.invokeParams()?.params, {
      function: '(a, b) => a + b',
    });
  });

  it('parses string[] as JSON array literals and does not split on commas', async () => {
    const client = new FakeDaemon(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(
      ['evaluate_script', '--function', '() => 1', '--args', '["u1","u2"]'],
      ctxWith(client),
    );
    assert.deepStrictEqual(client.invokeParams()?.params, {
      function: '() => 1',
      args: ['u1', 'u2'],
    });

    await toolDispatcherCommand(
      ['evaluate_script', '--function', '() => 1', '--args', 'u1,u2'],
      ctxWith(client),
    );
    const second = client.calls.filter(c => c.method === 'tool.invoke')[1];
    assert.deepStrictEqual((second.params as Record<string, unknown>).params, {
      function: '() => 1',
      args: 'u1,u2',
    });
  });

  it('disambiguates `select` to select_page via --pageId', async () => {
    const client = new FakeDaemon(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(['select', '--pageId', '0'], ctxWith(client));
    assert.strictEqual(
      (client.invokeParams()?.tool as string) ?? '',
      'select_page',
    );
  });

  it('disambiguates `select` to select_frame via --frameId', async () => {
    const client = new FakeDaemon(ALL_TOOLS, {ok: true});
    await toolDispatcherCommand(['select', '--frameId', 'f1'], ctxWith(client));
    assert.strictEqual(client.invokeParams()?.tool, 'select_frame');
  });

  it('still throws UNKNOWN_TOOL when `select` has no disambiguating flag', async () => {
    const client = new FakeDaemon(ALL_TOOLS, {ok: true});
    await assert.rejects(
      async () => toolDispatcherCommand(['select'], ctxWith(client)),
      (err: unknown) => {
        const e = err as AxiError;
        return e instanceof AxiError && e.code === 'UNKNOWN_TOOL';
      },
    );
  });
});

describe('invokeWithBusyRetry', () => {
  it('uses the documented [200, 500, 1000] backoff sequence', () => {
    assert.deepStrictEqual(BUSY_RETRY_DELAYS_MS, [200, 500, 1000]);
  });

  it('retries WORKER_BUSY then returns the result', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {ok: true});
    client.busyFailures = 2;
    const started = Date.now();
    const result = await invokeWithBusyRetry(client, 'my_tool', {}, [1, 1]);
    assert.deepStrictEqual(result, {ok: true});
    assert.ok(Date.now() - started >= 2);
    const invokes = client.calls.filter(c => c.method === 'tool.invoke');
    assert.strictEqual(invokes.length, 3);
  });

  it('gives up after the backoff sequence is exhausted', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {ok: true});
    client.busyFailures = 10;
    await assert.rejects(
      () => invokeWithBusyRetry(client, 'my_tool', {}, [1, 1]),
      /WORKER_BUSY/,
    );
    const invokes = client.calls.filter(c => c.method === 'tool.invoke');
    assert.strictEqual(invokes.length, 3);
  });

  it('does not retry non-busy errors', async () => {
    const client = new FakeDaemon(SAMPLE_TOOLS, {ok: true});
    client.invokeError = new Error('[TOOL_NOT_FOUND] nope');
    await assert.rejects(
      () => invokeWithBusyRetry(client, 'my_tool', {}, [1, 1]),
      /TOOL_NOT_FOUND/,
    );
    assert.strictEqual(
      client.calls.filter(c => c.method === 'tool.invoke').length,
      1,
    );
  });
});

describe('buildToolArgs complex arguments parsing', () => {
  it('parses JSON array for string[] and leaves comma-separated string as scalar', () => {
    const parsedWithJson = buildToolArgs(
      parseArgs(['--events', '["click","submit"]']),
      {
        events: {type: 'string[]', required: true, description: ''},
      },
    );
    assert.deepStrictEqual(parsedWithJson, {events: ['click', 'submit']});

    const parsedWithScalar = buildToolArgs(
      parseArgs(['--events', 'click,submit']),
      {
        events: {type: 'string[]', required: true, description: ''},
      },
    );
    assert.deepStrictEqual(parsedWithScalar, {events: 'click,submit'});
  });

  it('accepts JSON objects for --data', () => {
    const parsedWithData = buildToolArgs(
      parseArgs(['--data', '{"foo":"bar","num":42}']),
      {},
    );
    assert.deepStrictEqual(parsedWithData, {foo: 'bar', num: 42});
  });
});
