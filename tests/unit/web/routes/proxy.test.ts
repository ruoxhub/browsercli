/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';
import {RestRouter} from '../../../../src/web/RestRouter.js';
import {createProxyRoutes} from '../../../../src/web/routes/proxy.js';
import {WsHub} from '../../../../src/web/ws/WsHub.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string | Buffer;
  setHeader(k: string, v: string | number): void;
  end(payload?: string | Buffer): void;
  headersSent: boolean;
}

function mockReq(
  method: string,
  url: string,
  bodyObj?: Record<string, unknown>,
): IncomingMessage {
  const e = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  e.method = method;
  e.url = url;
  if (bodyObj !== undefined) {
    process.nextTick(() => {
      e.emit('data', Buffer.from(JSON.stringify(bodyObj)));
      e.emit('end');
    });
  } else {
    process.nextTick(() => {
      e.emit('end');
    });
  }
  return e;
}

function mockRes(): MockRes {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = String(v);
    },
    end(payload?: string | Buffer) {
      if (payload !== undefined) {
        this.body = payload;
      }
      this.headersSent = true;
    },
  };
}

describe('Proxy REST Routes', () => {
  let tmpDir: string;
  let mitmModule: MitmModule;
  let wsHub: WsHub;
  let router: RestRouter;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'proxy-route-test-'));
    mitmModule = new MitmModule(tmpDir);
    wsHub = new WsHub();
    router = new RestRouter();
    router.mount(createProxyRoutes(mitmModule, wsHub));
  });

  afterEach(async () => {
    await mitmModule.stop();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, {recursive: true, force: true});
    }
  });

  it('should register all expected proxy endpoints in router', () => {
    const routes = createProxyRoutes(mitmModule, wsHub);
    assert.ok(routes.has('GET /api/proxy/status'));
    assert.ok(routes.has('POST /api/proxy/start'));
    assert.ok(routes.has('POST /api/proxy/stop'));
    assert.ok(routes.has('GET /api/proxy/requests'));
    assert.ok(routes.has('GET /api/proxy/requests/:id'));
    assert.ok(routes.has('DELETE /api/proxy/requests'));
    assert.ok(routes.has('GET /api/proxy/ca/download'));
    assert.ok(routes.has('GET /api/proxy/ips'));
  });

  it('GET /api/proxy/status returns status and CA info', async () => {
    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/proxy/status'),
      res as unknown as ServerResponse,
      '/api/proxy/status',
    );
    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);

    const parsed = JSON.parse(res.body.toString()) as {
      success: boolean;
      data: {
        running: boolean;
        port: number | null;
        capturedCount: number;
        caInitialized: boolean;
        caCertPath: string;
      };
    };
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.running, false);
    assert.strictEqual(parsed.data.port, null);
    assert.strictEqual(parsed.data.capturedCount, 0);
    assert.strictEqual(typeof parsed.data.caInitialized, 'boolean');
    assert.ok(parsed.data.caCertPath.endsWith('ca-cert.pem'));
  });

  it('POST /api/proxy/start and POST /api/proxy/stop control proxy lifecycle', async () => {
    let broadcastStatus: any = null;
    const origBroadcast = wsHub.broadcast.bind(wsHub);
    wsHub.broadcast = (channel, payload, filterFn) => {
      if (channel === 'proxy.status') {
        broadcastStatus = payload;
      }
      return origBroadcast(channel, payload, filterFn);
    };

    // 1. Start on ephemeral port 0
    const startRes = mockRes();
    const startMatched = await router.dispatch(
      mockReq('POST', '/api/proxy/start', {port: 0}),
      startRes as unknown as ServerResponse,
      '/api/proxy/start',
    );
    assert.strictEqual(startMatched, true);
    assert.strictEqual(startRes.statusCode, 200);
    const startData = JSON.parse(startRes.body.toString());
    assert.strictEqual(startData.success, true);
    assert.ok(startData.data.port > 0);
    assert.strictEqual(broadcastStatus?.running, true);

    // 2. Stop
    const stopRes = mockRes();
    const stopMatched = await router.dispatch(
      mockReq('POST', '/api/proxy/stop'),
      stopRes as unknown as ServerResponse,
      '/api/proxy/stop',
    );
    assert.strictEqual(stopMatched, true);
    assert.strictEqual(stopRes.statusCode, 200);
    const stopData = JSON.parse(stopRes.body.toString());
    assert.strictEqual(stopData.success, true);
    assert.strictEqual(stopData.data.running, false);
    assert.strictEqual(broadcastStatus?.running, false);
  });

  it('POST /api/proxy/start 支持透传 upstreamProxy 参数', async () => {
    const startRes = mockRes();
    const startMatched = await router.dispatch(
      mockReq('POST', '/api/proxy/start', {
        port: 0,
        upstreamProxy: 'socks5://127.0.0.1:1080',
      }),
      startRes as unknown as ServerResponse,
      '/api/proxy/start',
    );
    assert.strictEqual(startMatched, true);
    assert.strictEqual(startRes.statusCode, 200);
    const startData = JSON.parse(startRes.body.toString());
    assert.strictEqual(startData.success, true);
    assert.strictEqual(startData.data.upstreamProxy, 'socks5://127.0.0.1:1080');

    const statusRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/status'),
      statusRes as unknown as ServerResponse,
      '/api/proxy/status',
    );
    const statusData = JSON.parse(statusRes.body.toString());
    assert.strictEqual(
      statusData.data.upstreamProxy,
      'socks5://127.0.0.1:1080',
    );

    await mitmModule.stop();
  });

  it('GET /api/proxy/requests and GET /api/proxy/requests/:id manage request query', async () => {
    const store = mitmModule.getStore();
    store.add({
      requestId: 'req-1',
      method: 'GET',
      url: 'https://example.com/api/test',
      requestHeaders: {'x-foo': 'bar'},
      requestBody: null,
      statusCode: 200,
      responseHeaders: {'content-type': 'application/json'},
      responseBody: '{"hello":"world"}',
      contentType: 'application/json',
      isOptions: false,
      isStatic: false,
      isStreaming: false,
      isWebSocket: false,
      truncated: false,
      timestamp: Date.now(),
      modified: false,
    });
    store.add({
      requestId: 'req-2',
      method: 'POST',
      url: 'https://other.com/login',
      requestHeaders: {},
      requestBody: 'user=admin',
      statusCode: 302,
      responseHeaders: {},
      responseBody: '',
      contentType: 'text/html',
      isOptions: false,
      isStatic: false,
      isStreaming: false,
      isWebSocket: false,
      truncated: false,
      timestamp: Date.now(),
      modified: false,
    });

    // List all
    const listRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/requests'),
      listRes as unknown as ServerResponse,
      '/api/proxy/requests',
    );
    const listParsed = JSON.parse(listRes.body.toString());
    assert.strictEqual(listParsed.success, true);
    assert.strictEqual(listParsed.data.total, 2);
    assert.strictEqual(listParsed.data.requests.length, 2);

    // List with filter
    const filterRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/requests?urlFilter=other.com'),
      filterRes as unknown as ServerResponse,
      '/api/proxy/requests',
    );
    const filterParsed = JSON.parse(filterRes.body.toString());
    assert.strictEqual(filterParsed.data.total, 1);
    assert.strictEqual(filterParsed.data.requests[0].method, 'POST');

    // Get detail
    const detailRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/requests/1'),
      detailRes as unknown as ServerResponse,
      '/api/proxy/requests/1',
    );
    const detailParsed = JSON.parse(detailRes.body.toString());
    assert.strictEqual(detailParsed.success, true);
    assert.strictEqual(detailParsed.data.id, 1);
    assert.strictEqual(detailParsed.data.responseBody, '{"hello":"world"}');

    // Get 404 for nonexistent id
    const notFoundRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/requests/999'),
      notFoundRes as unknown as ServerResponse,
      '/api/proxy/requests/999',
    );
    assert.strictEqual(notFoundRes.statusCode, 404);
  });

  it('DELETE /api/proxy/requests clears captured requests', async () => {
    const store = mitmModule.getStore();
    store.add({
      requestId: 'req-1',
      method: 'GET',
      url: 'https://example.com/api',
      requestHeaders: {},
      requestBody: null,
      statusCode: 200,
      responseHeaders: {},
      responseBody: null,
      contentType: null,
      isOptions: false,
      isStatic: false,
      isStreaming: false,
      isWebSocket: false,
      truncated: false,
      timestamp: Date.now(),
      modified: false,
    });
    assert.strictEqual(store.size(), 1);

    const delRes = mockRes();
    await router.dispatch(
      mockReq('DELETE', '/api/proxy/requests'),
      delRes as unknown as ServerResponse,
      '/api/proxy/requests',
    );
    assert.strictEqual(delRes.statusCode, 200);
    const delParsed = JSON.parse(delRes.body.toString());
    assert.strictEqual(delParsed.success, true);
    assert.strictEqual(delParsed.data.clearedCount, 1);
    assert.strictEqual(store.size(), 0);
  });

  it('GET /api/proxy/ca/download downloads PEM and DER certs', async () => {
    // 1. PEM download
    const pemRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/ca/download?format=pem'),
      pemRes as unknown as ServerResponse,
      '/api/proxy/ca/download',
    );
    assert.strictEqual(pemRes.statusCode, 200);
    assert.strictEqual(
      pemRes.headers['content-type'],
      'application/x-pem-file',
    );
    assert.strictEqual(
      pemRes.headers['content-disposition'],
      'attachment; filename="mitm-ca.pem"',
    );
    assert.ok(pemRes.body.toString().includes('BEGIN CERTIFICATE'));

    // 2. DER download
    const derRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/ca/download?format=der'),
      derRes as unknown as ServerResponse,
      '/api/proxy/ca/download',
    );
    assert.strictEqual(derRes.statusCode, 200);
    assert.strictEqual(
      derRes.headers['content-type'],
      'application/x-x509-ca-cert',
    );
    assert.strictEqual(
      derRes.headers['content-disposition'],
      'attachment; filename="mitm-ca.der"',
    );
    assert.ok(Buffer.isBuffer(derRes.body));
    assert.ok(derRes.body.length > 0);
  });

  it('GET /api/proxy/ips returns network interfaces', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/proxy/ips'),
      res as unknown as ServerResponse,
      '/api/proxy/ips',
    );
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body.toString());
    assert.strictEqual(parsed.success, true);
    assert.ok(Array.isArray(parsed.data.ips));
  });
});
