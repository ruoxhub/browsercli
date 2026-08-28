/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {statusCommand} from '../../src/commands/status.js';
import type {AxiStructuredOutput} from '../../src/output.js';
import type {WorkerContext} from '../../src/types.js';
import type {WorkerHttpClient} from '../../src/WorkerHttpClient.js';

describe('statusCommand', () => {
  const emptyCtx: WorkerContext = {
    httpClient: undefined,
    transport: 'http',
  };

  it('returns offline status when no httpClient is provided', async () => {
    const output = (await statusCommand([], emptyCtx)) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'status');
    assert.strictEqual(output.online, false);
    assert.ok(Array.isArray(output.rows));
  });

  it('returns json format when --json flag is passed', async () => {
    const output = (await statusCommand(
      ['--json'],
      emptyCtx,
    )) as AxiStructuredOutput;
    assert.strictEqual(output.command, 'status');
    assert.strictEqual(output.status, 'success');
    assert.strictEqual(output.online, false);
    assert.strictEqual(output.sessionsCount, 0);
    assert.strictEqual(output.toolsCount, 0);
  });

  it('returns online status when httpClient health and endpoints succeed', async () => {
    const mockHttpClient = {
      baseUrl: 'http://127.0.0.1:8765',
      health: async () => ({status: 'ok'}),
      listSessions: async () => ({sessions: [{id: 's1'}, {id: 's2'}]}),
      listTools: async () => ({
        tools: [{name: 'tool1'}, {name: 'tool2'}, {name: 'tool3'}],
      }),
    } as unknown as WorkerHttpClient;

    const output = (await statusCommand(['--json'], {
      httpClient: mockHttpClient,
      transport: 'http',
    })) as AxiStructuredOutput;

    assert.strictEqual(output.command, 'status');
    assert.strictEqual(output.online, true);
    assert.strictEqual(output.workerUrl, 'http://127.0.0.1:8765');
    assert.strictEqual(output.sessionsCount, 2);
    assert.strictEqual(output.toolsCount, 3);
    assert.strictEqual(output.transport, 'http');
  });

  it('returns table output format when online without --json flag', async () => {
    const mockHttpClient = {
      baseUrl: 'http://127.0.0.1:8765',
      health: async () => ({status: 'ok'}),
      listSessions: async () => ({sessions: []}),
      listTools: async () => ({tools: [{name: 'tool1'}]}),
    } as unknown as WorkerHttpClient;

    const output = (await statusCommand([], {
      httpClient: mockHttpClient,
      transport: 'http',
    })) as AxiStructuredOutput;

    assert.strictEqual(output.command, 'status');
    assert.strictEqual(output.online, true);
    assert.ok(Array.isArray(output.headers));
    assert.ok(Array.isArray(output.rows));
    assert.strictEqual(output.rows!.length, 5);
  });
});
