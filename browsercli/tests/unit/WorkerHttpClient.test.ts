import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';

import {WebSocketServer} from 'ws';

import {
  WorkerHttpClient,
  type JobStatus,
  type ToolRecovery,
} from '../../src/WorkerHttpClient.js';

describe('WorkerHttpClient.invoke (request-response wrapper)', () => {
  let server: any;
  let base: string;

  before(async () => {
    server = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url === '/api/v1/sessions') {
        res.statusCode = 201;
        res.end(
          JSON.stringify({
            sessionId: 'sess_x',
            createdAt: new Date().toISOString(),
          }),
        );
        return;
      }
      // 真实路由为 POST /sessions/:id/invoke -> 202 {jobId,sessionId,status}
      const inv = url.match(/^\/api\/v1\/sessions\/(.+)\/invoke$/);
      if (req.method === 'POST' && inv) {
        res.statusCode = 202;
        res.end(
          JSON.stringify({
            jobId: 'job_1',
            sessionId: inv[1],
            status: 'pending',
          }),
        );
        return;
      }
      const m = url.match(/^\/api\/v1\/jobs\/(.+)$/);
      if (m) {
        const job = {jobId: m[1], status: 'done', result: {hello: 'world'}};
        res.statusCode = 200;
        res.end(JSON.stringify(job));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  after(() => server.close());

  it('invoke awaits final result (request-response)', async () => {
    const client = new WorkerHttpClient({baseUrl: base, timeoutMs: 2000});
    const result = await client.invoke('sess_x', 'any_tool', {});
    assert.deepEqual(result, {hello: 'world'});
  });

  it('invoke reuses cached session across calls', async () => {
    const client = new WorkerHttpClient({baseUrl: base});
    const s1 = await client.ensureSession();
    const s2 = await client.ensureSession();
    assert.equal(s1, s2);
  });

  it('invoke throws on failed job', async () => {
    const failing = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url === '/api/v1/sessions') {
        res.statusCode = 201;
        res.end(JSON.stringify({sessionId: 's'}));
        return;
      }
      const inv = url.match(/^\/api\/v1\/sessions\/(.+)\/invoke$/);
      if (req.method === 'POST' && inv) {
        res.statusCode = 202;
        res.end(
          JSON.stringify({
            jobId: 'job_1',
            sessionId: inv[1],
            status: 'pending',
          }),
        );
        return;
      }
      const m = url.match(/^\/api\/v1\/jobs\/(.+)$/);
      if (m) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            jobId: m[1],
            status: 'failed',
            error: {code: 'X', message: 'boom'},
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(r => failing.listen(0, '127.0.0.1', () => r()));
    const p = `http://127.0.0.1:${(failing.address() as any).port}`;
    const client = new WorkerHttpClient({baseUrl: p});
    await assert.rejects(() => client.invoke('s', 't', {}), /boom/);
    failing.close();
  });

  it('getJob mirrors error recovery, retryable, and details in JobStatus', async () => {
    const recovery: ToolRecovery = {
      tool: 'launch_browser',
      command: 'browsercli browser connect',
      reason: 'Browser must be connected',
    };
    const expectedJob: JobStatus = {
      jobId: 'job_rec_1',
      sessionId: 'sess_x',
      tool: 'navigate_page',
      status: 'failed',
      error: {
        code: 'BROWSER_REQUIRED',
        message: 'No browser connection',
        retryable: false,
        recovery,
        details: {reason: 'detached'},
      },
      logs: ['starting job'],
      createdAt: new Date().toISOString(),
    };
    const jobServer = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify(expectedJob));
    });
    await new Promise<void>(resolve =>
      jobServer.listen(0, '127.0.0.1', resolve),
    );
    const p = `http://127.0.0.1:${(jobServer.address() as any).port}`;
    const client = new WorkerHttpClient({baseUrl: p});
    const job = await client.getJob('job_rec_1');

    assert.equal(job.jobId, 'job_rec_1');
    assert.equal(job.error?.code, 'BROWSER_REQUIRED');
    assert.equal(job.error?.retryable, false);
    assert.deepEqual(job.error?.recovery, recovery);
    assert.deepEqual(job.error?.details, {reason: 'detached'});
    jobServer.close();
  });

  it('invoke throws on timed out and cancelled jobs', async () => {
    const terminalJobs = [
      {
        status: 'timed_out',
        error: {code: 'JOB_TIMEOUT', message: 'timed out'},
      },
      {
        status: 'cancelled',
        error: {code: 'JOB_CANCELLED', message: 'cancelled'},
      },
    ];
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && /\/sessions\/.+\/invoke$/.test(url)) {
        res.statusCode = 202;
        res.end(JSON.stringify({jobId: 'job_1', status: 'pending'}));
        return;
      }
      if (/\/jobs\/.+$/.test(url)) {
        res.end(JSON.stringify({jobId: 'job_1', ...terminalJobs.shift()}));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const client = new WorkerHttpClient({baseUrl});

    try {
      await assert.rejects(
        () => client.invoke('s', 't', {}),
        /JOB_TIMEOUT.*timed out/,
      );
      await assert.rejects(
        () => client.invoke('s', 't', {}),
        /JOB_CANCELLED.*cancelled/,
      );
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('cancels the worker job when its polling deadline expires', async () => {
    let cancelCalls = 0;
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && /\/sessions\/.+\/invoke$/.test(url)) {
        res.statusCode = 202;
        res.end(JSON.stringify({jobId: 'job_stuck', status: 'pending'}));
        return;
      }
      if (req.method === 'POST' && url === '/api/v1/jobs/job_stuck/cancel') {
        cancelCalls += 1;
        res.end(JSON.stringify({jobId: 'job_stuck', status: 'cancelled'}));
        return;
      }
      if (req.method === 'GET' && url === '/api/v1/jobs/job_stuck') {
        res.end(JSON.stringify({jobId: 'job_stuck', status: 'running'}));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const client = new WorkerHttpClient({
      baseUrl,
      timeoutMs: 20,
      pollIntervalMs: 1,
    });

    try {
      await assert.rejects(
        () => client.invoke('s', 'fill', {}),
        /invoke timeout.*job_stuck/,
      );
      assert.equal(cancelCalls, 1);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('WorkerHttpClient.listTools (normalization)', () => {
  function startToolsServer(body: unknown) {
    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify(body));
    });
    return new Promise<{server: any; base: string}>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        resolve({
          server,
          base: `http://127.0.0.1:${(server.address() as any).port}`,
        });
      });
    });
  }

  it('returns tools from the standard {tools:[...]} envelope', async () => {
    const {server, base} = await startToolsServer({
      success: true,
      data: {tools: [{name: 'list_pages'}]},
    });
    const client = new WorkerHttpClient({baseUrl: base});
    const {tools} = await client.listTools();
    assert.deepEqual(tools, [{name: 'list_pages'}]);
    server.close();
  });

  it('tolerates data being the array directly (older worker)', async () => {
    const {server, base} = await startToolsServer({
      success: true,
      data: [{name: 'list_pages'}],
    });
    const client = new WorkerHttpClient({baseUrl: base});
    const {tools} = await client.listTools();
    assert.deepEqual(tools, [{name: 'list_pages'}]);
    server.close();
  });

  it('returns empty array when tools key is missing (never crashes)', async () => {
    const {server, base} = await startToolsServer({success: true, data: {}});
    const client = new WorkerHttpClient({baseUrl: base});
    const {tools} = await client.listTools();
    assert.deepEqual(tools, []);
    server.close();
  });
});

describe('WorkerHttpClient transport bounds', () => {
  it('aborts an HTTP request that exceeds timeoutMs', async () => {
    const slowServer = createServer((_req, res) => {
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({status: 'ok'}));
      }, 100);
    });
    await new Promise<void>(resolve =>
      slowServer.listen(0, '127.0.0.1', resolve),
    );
    const baseUrl = `http://127.0.0.1:${(slowServer.address() as any).port}`;

    try {
      const client = new WorkerHttpClient({baseUrl, timeoutMs: 20});
      await assert.rejects(() => client.health());
    } finally {
      await new Promise<void>(resolve => slowServer.close(() => resolve()));
    }
  });

  it('subscribes to every stream channel after opening WebSocket', async () => {
    const server = createServer();
    const wsServer = new WebSocketServer({server});
    const received: unknown[] = [];
    let resolveMessages!: (messages: unknown[]) => void;
    const messages = new Promise<unknown[]>(resolve => {
      resolveMessages = resolve;
    });
    wsServer.on('connection', socket => {
      socket.on('message', data => {
        received.push(JSON.parse(data.toString()));
        if (received.length === 4) resolveMessages(received);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const client = new WorkerHttpClient({baseUrl, timeoutMs: 200});
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const close = await client.openStream('sess_x', () => {});
      const actual = await Promise.race([
        messages,
        new Promise<unknown[]>(resolve => {
          timeout = setTimeout(() => resolve(received), 100);
        }),
      ]);

      assert.deepEqual(actual, [
        {type: 'subscribe', channel: 'tool.invoke'},
        {type: 'subscribe', channel: 'hook.event'},
        {type: 'subscribe', channel: 'hook.sample'},
        {type: 'subscribe', channel: 'log'},
      ]);
      close();
    } finally {
      if (timeout) clearTimeout(timeout);
      for (const socket of wsServer.clients) socket.terminate();
      await new Promise<void>(resolve => wsServer.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
