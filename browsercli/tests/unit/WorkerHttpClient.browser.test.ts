import assert from 'node:assert/strict';
import {createServer, type IncomingMessage} from 'node:http';
import {describe, it} from 'node:test';

import {WorkerHttpClient} from '../../src/WorkerHttpClient.js';

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

describe('WorkerHttpClient browser control', () => {
  it('uses the v1 paths, body, and bearer token', async () => {
    const requests: Array<{
      method?: string;
      url?: string;
      authorization?: string;
      body?: unknown;
    }> = [];
    const server = createServer(async (req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: await readBody(req),
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          data:
            req.url === '/api/v1/jobs'
              ? {
                  jobs: [
                    {
                      jobId: 'job/1',
                      sessionId: 'session-1',
                      tool: 'fill',
                      status: 'running',
                      logs: [],
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : req.url?.startsWith('/api/v1/jobs/')
                ? {
                    jobId: 'job/1',
                    sessionId: 'session-1',
                    status: 'cancelled',
                    logs: [],
                    createdAt: new Date().toISOString(),
                  }
                : req.url === '/api/v1/browser/disconnect'
                  ? {connected: false, mode: 'disconnected', pages: 0}
                  : {connected: true, mode: 'attach', pages: 2},
        }),
      );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as {port: number}).port}`;

    try {
      const client = new WorkerHttpClient({baseUrl, apiToken: 'secret'});
      await client.getBrowserStatus();
      await client.connectBrowser({
        browserURL: 'http://127.0.0.1:9222',
        headless: false,
      });
      await client.disconnectBrowser();
      await client.disconnectBrowser({force: true});
      const jobs = await client.listJobs();
      await client.cancelJob('job/1');

      assert.equal(jobs.jobs[0]?.tool, 'fill');

      assert.deepEqual(requests, [
        {
          method: 'GET',
          url: '/api/v1/browser/status',
          authorization: 'Bearer secret',
          body: undefined,
        },
        {
          method: 'POST',
          url: '/api/v1/browser/connect',
          authorization: 'Bearer secret',
          body: {
            browserURL: 'http://127.0.0.1:9222',
            headless: false,
          },
        },
        {
          method: 'POST',
          url: '/api/v1/browser/disconnect',
          authorization: 'Bearer secret',
          body: undefined,
        },
        {
          method: 'POST',
          url: '/api/v1/browser/disconnect',
          authorization: 'Bearer secret',
          body: {force: true},
        },
        {
          method: 'GET',
          url: '/api/v1/jobs',
          authorization: 'Bearer secret',
          body: undefined,
        },
        {
          method: 'POST',
          url: '/api/v1/jobs/job%2F1/cancel',
          authorization: 'Bearer secret',
          body: undefined,
        },
      ]);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
