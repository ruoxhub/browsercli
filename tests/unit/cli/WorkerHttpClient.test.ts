import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WorkerHttpClient} from '../../../src/cli/WorkerHttpClient.js';

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
});
