/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import net from 'node:net';
import {describe, it} from 'node:test';

import {
  startDaemonServer,
  type DaemonDeps,
  type DaemonHandle,
} from '../../../src/ipc/daemonServer.js';
import {makePipePath} from '../../../src/ipc/registry.js';
import {
  PROTOCOL_VERSION,
  SocketConnection,
  type DaemonMessage,
} from '../../../src/ipc/socketConnection.js';
import type {ToolMeta} from '../../../src/tools/tools-meta.js';
import {WsHub} from '../../../src/web/ws/WsHub.js';
import {JobStore} from '../../../src/worker/JobStore.js';

interface Gate {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

function createStubAdapter() {
  const pending: Gate[] = [];
  return {
    pending,
    executeTool: async (
      _meta: ToolMeta,
      params: Record<string, unknown>,
      _sessionId?: string,
      _signal?: AbortSignal,
    ): Promise<unknown> => {
      if (params.immediate !== undefined) {
        return params.immediate;
      }
      return new Promise((resolve, reject) => {
        pending.push({resolve: resolve as (v: unknown) => void, reject});
      });
    },
  };
}

class TestClient {
  private readonly messages: DaemonMessage[] = [];
  private readonly waiters: Array<() => void> = [];
  private nextId = 1;
  private constructor(private readonly conn: SocketConnection) {
    conn.onmessage = message => {
      this.messages.push(message);
      for (const wake of this.waiters.splice(0)) wake();
    };
  }

  static async connect(socketPath: string): Promise<TestClient> {
    const socket = net.connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    return new TestClient(new SocketConnection(socket));
  }

  async request(method: string, params?: Record<string, unknown>) {
    const id = this.nextId++;
    await this.conn.send({id, method, params});
    return id;
  }

  async waitFor(
    predicate: (message: DaemonMessage) => boolean,
    timeoutMs = 5_000,
  ): Promise<DaemonMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) return found;
      assert.ok(Date.now() < deadline, 'timed out waiting for daemon message');
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  async responseFor(id: number): Promise<DaemonMessage> {
    return this.waitFor(message => message['id'] === id);
  }

  close(): void {
    this.conn.close();
  }
}

function stubMeta(name: string): ToolMeta {
  return {
    name,
    description: '',
    schema: {},
    argSpecs: {},
    modulePath: './stub.js',
    handlerName: 'stub',
  } as ToolMeta;
}

interface Fixture {
  deps: DaemonDeps;
  handle: DaemonHandle;
  adapter: ReturnType<typeof createStubAdapter>;
  jobStore: JobStore;
  stopCalls: {count: number};
}

async function startFixture(): Promise<Fixture> {
  const adapter = createStubAdapter();
  const jobStore = new JobStore();
  const stopCalls = {count: 0};
  const deps = {
    sessionName: 't',
    version: '9.9.9',
    startedAt: Date.now(),
    runtime: {contextProvider: {}, browserManager: {}},
    contextProvider: {},
    toolAdapter: adapter,
    jobStore,
    wsHub: new WsHub(),
    listToolsMeta: () => [stubMeta('alpha'), stubMeta('beta')],
    getToolMeta: (name: string) =>
      name === 'alpha' || name === 'echo' ? stubMeta(name) : undefined,
    onStop: async () => {
      stopCalls.count += 1;
    },
  } as unknown as DaemonDeps;
  const handle = await startDaemonServer(
    deps,
    makePipePath(cryptoRandom(), 't'),
  );
  return {deps, handle, adapter, jobStore, stopCalls};
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function withFixture(
  run: (fixture: Fixture, client: TestClient) => Promise<void>,
): Promise<void> {
  const fixture = await startFixture();
  const client = await TestClient.connect(fixture.handle.socketPath);
  try {
    await run(fixture, client);
  } finally {
    client.close();
    await fixture.handle.close();
  }
}

describe('daemonServer', () => {
  it('hello returns version/protocol/pid/session', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('hello');
      const response = await client.responseFor(id);
      assert.deepStrictEqual(response['error'], undefined);
      const result = response['result'] as Record<string, unknown>;
      assert.equal(result.version, '9.9.9');
      assert.equal(result.protocol, PROTOCOL_VERSION);
      assert.equal(result.pid, process.pid);
      assert.equal(result.session, 't');
    });
  });

  it('tools.list passes through listToolsMeta', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('tools.list');
      const response = await client.responseFor(id);
      const result = response['result'] as {tools: ToolMeta[]};
      assert.deepEqual(
        result.tools.map(tool => tool.name),
        ['alpha', 'beta'],
      );
    });
  });

  it('tool.invoke returns the job result and records a done job', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('tool.invoke', {
        tool: 'echo',
        params: {immediate: {echo: 'hi'}},
      });
      const response = await client.responseFor(id);
      assert.deepStrictEqual(response['result'], {echo: 'hi'});
      const jobs = fixture.jobStore.list();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, 'done');
      assert.deepEqual(jobs[0].result, {echo: 'hi'});
    });
  });

  it('second tool.invoke while busy gets WORKER_BUSY', async () => {
    await withFixture(async (fixture, client) => {
      const firstId = await client.request('tool.invoke', {
        tool: 'alpha',
        params: {},
      });
      const secondId = await client.request('tool.invoke', {
        tool: 'alpha',
        params: {immediate: true},
      });
      const second = await client.responseFor(secondId);
      const error = second['error'] as {code: string};
      assert.equal(error.code, 'WORKER_BUSY');
      fixture.adapter.pending[0].resolve({echo: 'first'});
      const first = await client.responseFor(firstId);
      assert.deepStrictEqual(first['result'], {echo: 'first'});
    });
  });

  it('client disconnect aborts the running job and cancels it', async () => {
    const fixture = await startFixture();
    const client = await TestClient.connect(fixture.handle.socketPath);
    try {
      await client.request('tool.invoke', {tool: 'alpha', params: {}});
      // 等 job 进入 running，再断线
      for (let i = 0; i < 100 && !fixture.jobStore.list()[0]; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      client.close();
      fixture.adapter.pending[0].reject(
        Object.assign(new Error('job cancelled'), {code: 'JOB_CANCELLED'}),
      );
      for (
        let i = 0;
        i < 100 && fixture.jobStore.list()[0].status !== 'cancelled';
        i++
      ) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const job = fixture.jobStore.list()[0];
      assert.equal(job.status, 'cancelled');
      assert.equal(job.error?.code, 'JOB_CANCELLED');
    } finally {
      await fixture.handle.close();
    }
  });

  it('subscribe forwards wsHub broadcasts as event frames', async () => {
    await withFixture(async (fixture, client) => {
      const subId = await client.request('subscribe', {channels: ['log']});
      const subResponse = await client.responseFor(subId);
      assert.deepStrictEqual(subResponse['result'], {subscribed: ['log']});
      fixture.deps.wsHub.broadcast('log', {m: 1});
      const event = await client.waitFor(
        message => message['type'] === 'event',
      );
      assert.equal(event['channel'], 'log');
      assert.deepStrictEqual(event['payload'], {m: 1});
    });
  });

  it('stop replies ok then invokes onStop once', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('stop');
      const response = await client.responseFor(id);
      assert.equal(response['result'], 'ok');
      for (let i = 0; i < 100 && fixture.stopCalls.count === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(fixture.stopCalls.count, 1);
    });
  });
});
