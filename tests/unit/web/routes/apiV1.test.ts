/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {describe, it} from 'node:test';

import type {ToolMeta} from '../../../../src/tools/tools-meta.js';
import {
  type ApiV1Deps,
  type ApiV1Options,
  createApiV1Routes,
} from '../../../../src/web/routes/apiV1.js';
import {WsHub} from '../../../../src/web/ws/WsHub.js';
import {JobStore} from '../../../../src/worker/JobStore.js';
import type {ToolAdapter} from '../../../../src/worker/ToolAdapter.js';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  headersSent: boolean;
  setHeader(key: string, value: string): void;
  end(payload: string): void;
}

interface ApiData<T> {
  success: boolean;
  data: T;
  error?: {code: string; message: string};
}

const toolMeta = {
  name: 'test_tool',
  description: 'test tool',
  schema: {},
  argSpecs: {},
  modulePath: './test.js',
  handlerName: 'testTool',
  callMode: 'defineTool',
  domain: 'reverse',
  profile: 'full',
} as ToolMeta;

function mockRequest(body?: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(body)));
    }
    req.emit('end');
  });
  return req;
}

function mockResponse(): MockResponse {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload;
      this.headersSent = true;
    },
  };
}

function responseData<T>(res: MockResponse): ApiData<T> {
  return JSON.parse(res.body) as ApiData<T>;
}

function deps(
  executeTool: (
    meta: ToolMeta,
    params: Record<string, unknown>,
    sessionId?: string,
    signal?: AbortSignal,
  ) => Promise<unknown> = async () => ({ok: true}),
  jobStore = new JobStore(),
): ApiV1Deps {
  return {
    contextProvider: {
      isBrowserConnected: () => false,
      getContext: () => null,
    } as never,
    toolAdapter: {executeTool} as unknown as ToolAdapter,
    jobStore,
    wsHub: new WsHub(),
    getToolMeta: name => (name === toolMeta.name ? toolMeta : undefined),
    listToolsMeta: () => [toolMeta],
    ensureToolsMeta: async () => undefined,
  };
}

function routesFor(dependencies: ApiV1Deps, options: ApiV1Options = {}) {
  return createApiV1Routes(dependencies, options);
}

async function createSession(
  routes: ReturnType<typeof createApiV1Routes>,
): Promise<string> {
  const res = mockResponse();
  await routes.get('POST /api/v1/sessions')!(
    mockRequest(),
    res as unknown as ServerResponse,
  );
  return responseData<{sessionId: string}>(res).data.sessionId;
}

async function invoke(
  routes: ReturnType<typeof createApiV1Routes>,
  sessionId: string,
): Promise<MockResponse> {
  const res = mockResponse();
  await routes.get('POST /api/v1/sessions/:id/invoke')!(
    mockRequest({tool: toolMeta.name, params: {}}),
    res as unknown as ServerResponse,
    {id: sessionId},
  );
  return res;
}

async function waitForJobStatus(
  jobStore: JobStore,
  jobId: string,
  status: 'done' | 'timed_out' | 'cancelled',
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (jobStore.get(jobId).status === status) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('createApiV1Routes local worker state', () => {
  it('lists jobs for recovery tooling', async () => {
    const jobStore = new JobStore();
    const job = jobStore.create('session-1', toolMeta.name, {selector: '#x'});
    const routes = routesFor(deps(undefined, jobStore));
    const res = mockResponse();

    await routes.get('GET /api/v1/jobs')!(
      mockRequest(),
      res as unknown as ServerResponse,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      responseData<{jobs: Array<{jobId: string}>}>(res).data.jobs.map(
        listed => listed.jobId,
      ),
      [job.jobId],
    );
  });

  it('keeps sessions local to each route table', async () => {
    const first = routesFor(deps());
    const second = routesFor(deps());
    await createSession(first);

    const res = mockResponse();
    await second.get('GET /api/v1/sessions')!(
      mockRequest(),
      res as unknown as ServerResponse,
    );

    assert.deepEqual(
      responseData<{sessions: unknown[]}>(res).data.sessions,
      [],
    );
  });

  it('evicts the oldest session when the local cap is reached', async () => {
    const routes = routesFor(deps(), {maxSessions: 2});
    const first = await createSession(routes);
    const second = await createSession(routes);
    await invoke(routes, first);
    const third = await createSession(routes);
    const res = mockResponse();

    await routes.get('GET /api/v1/sessions')!(
      mockRequest(),
      res as unknown as ServerResponse,
    );

    const ids = responseData<{sessions: Array<{sessionId: string}>}>(
      res,
    ).data.sessions.map(session => session.sessionId);
    assert.deepEqual(ids, [second, third]);
    assert.ok(!ids.includes(first));
  });

  it('rejects concurrent API jobs while the local browser runtime is busy', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const jobStore = new JobStore();
    const routes = routesFor(
      deps(async () => {
        const call = ++calls;
        if (call === 1) await firstGate;
        return {call};
      }, jobStore),
    );
    const sessionId = await createSession(routes);

    const firstResponse = await invoke(routes, sessionId);
    const secondResponse = await invoke(routes, sessionId);

    try {
      assert.equal(firstResponse.statusCode, 202);
      assert.equal(secondResponse.statusCode, 409);
      assert.equal(
        responseData<never>(secondResponse).error?.code,
        'WORKER_BUSY',
      );
    } finally {
      releaseFirst();
    }

    const firstJobId = responseData<{jobId: string}>(firstResponse).data.jobId;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (jobStore.get(firstJobId).status === 'done') break;
      await new Promise(resolve => setImmediate(resolve));
    }

    assert.equal(jobStore.get(firstJobId).status, 'done');
    await new Promise(resolve => setImmediate(resolve));

    const thirdResponse = await invoke(routes, sessionId);
    assert.equal(thirdResponse.statusCode, 202);

    const thirdJobId = responseData<{jobId: string}>(thirdResponse).data.jobId;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (jobStore.get(thirdJobId).status === 'done') break;
      await new Promise(resolve => setImmediate(resolve));
    }

    assert.equal(jobStore.get(thirdJobId).status, 'done');
    assert.equal(calls, 2);
  });

  it('returns 503 when the bounded job store contains only active jobs', async () => {
    const jobStore = new JobStore({maxJobs: 1});
    jobStore.create('existing-session', toolMeta.name, {});
    const routes = routesFor(deps(undefined, jobStore));
    const sessionId = await createSession(routes);
    const response = await invoke(routes, sessionId);

    assert.equal(response.statusCode, 503);
    assert.equal(responseData<never>(response).error?.code, 'JOB_STORE_FULL');
  });

  it('times out a hung server job and accepts the next invoke', async () => {
    let calls = 0;
    const jobStore = new JobStore();
    const routes = routesFor(
      deps(async () => {
        if (++calls === 1) await new Promise<never>(() => undefined);
        return {ok: true};
      }, jobStore),
      {jobTimeoutMs: 20},
    );
    const sessionId = await createSession(routes);
    const first = await invoke(routes, sessionId);
    const firstJobId = responseData<{jobId: string}>(first).data.jobId;

    await waitForJobStatus(jobStore, firstJobId, 'timed_out');

    const timedOut = jobStore.get(firstJobId);
    assert.equal(timedOut.status, 'timed_out');
    assert.deepEqual(timedOut.error, {
      code: 'JOB_TIMEOUT',
      message: 'job timed out after 20ms',
    });
    assert.ok(timedOut.finishedAt);

    const second = await invoke(routes, sessionId);
    assert.equal(second.statusCode, 202);
  });

  it('cancels a hung job and accepts the next invoke', async () => {
    let calls = 0;
    const jobStore = new JobStore();
    const routes = routesFor(
      deps(async () => {
        if (++calls === 1) await new Promise<never>(() => undefined);
        return {ok: true};
      }, jobStore),
    );
    const sessionId = await createSession(routes);
    const first = await invoke(routes, sessionId);
    const jobId = responseData<{jobId: string}>(first).data.jobId;
    const cancelResponse = mockResponse();

    await routes.get('POST /api/v1/jobs/:id/cancel')!(
      mockRequest(),
      cancelResponse as unknown as ServerResponse,
      {id: jobId},
    );

    assert.equal(cancelResponse.statusCode, 200);
    assert.equal(
      responseData<{status: string}>(cancelResponse).data.status,
      'cancelled',
    );
    assert.deepEqual(jobStore.get(jobId).error, {
      code: 'JOB_CANCELLED',
      message: 'job cancelled by client',
    });
    assert.ok(jobStore.get(jobId).finishedAt);

    const second = await invoke(routes, sessionId);
    assert.equal(second.statusCode, 202);
  });
});
