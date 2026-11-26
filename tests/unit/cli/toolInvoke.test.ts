/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import type {DaemonEvent, DaemonLike} from '../../../src/cli/daemonClient.js';
import {formatToolResponseAsMarkdown} from '../../../src/cli/formatResponse.js';
import type {ToolMeta} from '../../../src/cli/tool-meta-types.js';
import {
  buildToolArgs,
  CliError,
  invokeTool,
  invokeWithBusyRetry,
  resolveOutputFormat,
} from '../../../src/cli/toolInvoke.js';

const SAMPLE_TOOLS: ToolMeta[] = [
  {
    name: 'my_tool',
    description: 'Sample tool',
    schema: {},
    argSpecs: {
      foo: {type: 'string', required: false, description: 'foo'},
      count: {type: 'number', required: false, description: 'count'},
      items: {type: 'string[]', required: false, description: 'items'},
    },
    modulePath: './my_tool.js',
    handlerName: 'myTool',
    callMode: 'defineTool',
    domain: 'reverse',
    profile: 'full',
  },
];

class FakeDaemon implements DaemonLike {
  calls: Array<{method: string; params?: Record<string, unknown>}> = [];
  busyFailures = 0;
  busyMessages: string[] = [];

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
      return {subscribed: params?.channels ?? []} as T;
    if (method === 'tool.invoke') {
      if (this.busyFailures > 0) {
        this.busyFailures--;
        throw new Error(this.busyMessages.shift() ?? '[WORKER_BUSY] busy');
      }
      return this.result as T;
    }
    return {} as T;
  }

  onEvent(_cb: (ev: DaemonEvent) => void): () => void {
    return () => undefined;
  }
  close(): void {
    // noop
  }
}

describe('toolInvoke', () => {
  it('merges --file, --data, and CLI flags with CLI > --data > --file precedence', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-args-'));
    try {
      const jsonFile = path.join(tmp, 'params.json');
      fs.writeFileSync(jsonFile, JSON.stringify({foo: 'from-file', count: 1}));

      const args = buildToolArgs(
        {foo: 'from-cli', items: '["a","b"]', session: 's1', watch: true},
        SAMPLE_TOOLS[0].argSpecs,
        {file: jsonFile, data: '{"foo":"from-data","count":2}'},
      );
      assert.deepEqual(args, {foo: 'from-cli', count: 2, items: ['a', 'b']});

      const jsFile = path.join(tmp, 'eval.js');
      fs.writeFileSync(jsFile, '() => document.title');
      const jsArgs = buildToolArgs({}, undefined, {file: jsFile});
      assert.deepEqual(jsArgs, {function: '() => document.title'});
    } finally {
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  });

  it('hits static tools-manifest.json without sending a tools.list RPC', async () => {
    const daemon = new FakeDaemon([], {
      structuredContent: {success: true, message: 'ok', data: {value: 42}},
    });
    const out = await invokeTool({
      toolName: 'evaluate_script',
      rawFlags: {},
      positionals: ['() => 42'],
      controlFlags: {outputFormat: 'md'},
      connect: async () => daemon,
    });

    assert.equal(out.tool, 'evaluate_script');
    assert.deepEqual(
      daemon.calls.map(c => c.method),
      ['tool.invoke'],
    );
    assert.deepEqual(daemon.calls[0]?.params, {
      tool: 'evaluate_script',
      params: {function: '() => 42'},
    });
    assert.match(out.rendered, /# evaluate_script/);
    assert.match(out.rendered, /"value": 42/);
  });

  it('falls back to tools.list for dynamic tools and throws UNKNOWN_TOOL on miss', async () => {
    const daemon = new FakeDaemon(SAMPLE_TOOLS, {hello: 'world'});
    const out = await invokeTool({
      toolName: 'my-tool',
      rawFlags: {foo: 'bar'},
      controlFlags: {json: true},
      connect: async () => daemon,
    });
    assert.equal(out.tool, 'my_tool');
    assert.deepEqual(JSON.parse(out.rendered), {hello: 'world'});

    await assert.rejects(
      async () =>
        invokeTool({
          toolName: 'nonexistent_xyz',
          rawFlags: {},
          connect: async () => daemon,
        }),
      (err: unknown) => err instanceof CliError && err.code === 'UNKNOWN_TOOL',
    );
  });

  it('rejects TOOL_FAILURE when structuredContent.success is false or isError is true', async () => {
    const d1 = new FakeDaemon(SAMPLE_TOOLS, {
      structuredContent: {success: false, message: 'boom'},
    });
    await assert.rejects(
      async () =>
        invokeTool({
          toolName: 'my_tool',
          rawFlags: {},
          connect: async () => d1,
        }),
      (err: unknown) =>
        err instanceof CliError &&
        err.code === 'TOOL_FAILURE' &&
        err.message.includes('boom'),
    );

    const d2 = new FakeDaemon(SAMPLE_TOOLS, {
      isError: true,
      content: [{type: 'text', text: 'mcp fail'}],
    });
    await assert.rejects(
      async () =>
        invokeTool({
          toolName: 'my_tool',
          rawFlags: {},
          connect: async () => d2,
        }),
      (err: unknown) =>
        err instanceof CliError &&
        err.code === 'TOOL_FAILURE' &&
        err.message.includes('mcp fail'),
    );
  });

  it('retries WORKER_BUSY errors and separates browser connect polling budget', async () => {
    const daemon = new FakeDaemon(SAMPLE_TOOLS, {ok: true});
    daemon.busyFailures = 3;
    daemon.busyMessages = [
      '[WORKER_BUSY] worker is busy with browser connect',
      '[WORKER_BUSY] worker is busy with browser connect',
      '[WORKER_BUSY] worker is busy running tools',
    ];
    const res = await invokeWithBusyRetry(
      daemon,
      'my_tool',
      {},
      [5, 5],
      500,
      5,
    );
    assert.deepEqual(res, {ok: true});
    assert.equal(daemon.calls.length, 4);
  });

  it('renders markdown with snapshot and console errors', () => {
    const md = formatToolResponseAsMarkdown('click', {
      structuredContent: {
        success: true,
        message: 'Clicked',
        snapshot: {snapshotId: '1', nodeCount: 2, textOutline: 'uid=1_0 btn'},
        consoleErrors: ['ReferenceError: x'],
      },
    });
    assert.match(md, /# click/);
    assert.match(md, /uid=1_0 btn/);
    assert.match(md, /ReferenceError: x/);
  });

  it('renders toon format via --output-format toon and --toon shorthand, and resolves precedence', async () => {
    const daemon = new FakeDaemon(SAMPLE_TOOLS, {
      structuredContent: {
        success: true,
        message: 'ok',
        data: {
          items: [
            {id: 1, name: 'alpha'},
            {id: 2, name: 'beta'},
          ],
        },
      },
    });

    const outFlag = await invokeTool({
      toolName: 'my_tool',
      rawFlags: {toon: true},
      controlFlags: {toon: true},
      connect: async () => daemon,
    });
    assert.equal(outFlag.format, 'toon');
    assert.match(outFlag.rendered, /items\[2\]\{id,name\}:/);
    assert.doesNotMatch(outFlag.rendered, /```json/);

    // Ensure --toon is stripped from tool params
    assert.deepEqual(daemon.calls.at(-1)?.params, {
      tool: 'my_tool',
      params: {},
    });

    const outFormat = await invokeTool({
      toolName: 'my_tool',
      rawFlags: {},
      controlFlags: {outputFormat: 'toon'},
      connect: async () => daemon,
    });
    assert.equal(outFormat.format, 'toon');
    assert.match(outFormat.rendered, /1,alpha/);

    // Conflict between --json and --toon
    assert.throws(
      () => resolveOutputFormat({json: true, toon: true}),
      (err: unknown) =>
        err instanceof CliError && err.code === 'VALIDATION_ERROR',
    );

    // Env and config precedence: CLI > env > config > toon
    const prevEnv = process.env.BROWSERCLI_OUTPUT_FORMAT;
    try {
      delete process.env.BROWSERCLI_OUTPUT_FORMAT;
      assert.equal(resolveOutputFormat({}, 'md'), 'md');
      assert.equal(resolveOutputFormat({}, undefined), 'toon');

      process.env.BROWSERCLI_OUTPUT_FORMAT = 'md';
      assert.equal(resolveOutputFormat({}, 'json'), 'md');
      assert.equal(resolveOutputFormat({json: true}, 'md'), 'json');
      assert.equal(
        resolveOutputFormat({json: true, outputFormat: 'toon'}, 'md'),
        'toon',
      );
    } finally {
      if (prevEnv === undefined) delete process.env.BROWSERCLI_OUTPUT_FORMAT;
      else process.env.BROWSERCLI_OUTPUT_FORMAT = prevEnv;
    }
  });
});
