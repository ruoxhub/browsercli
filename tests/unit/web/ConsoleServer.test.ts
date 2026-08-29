/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import {request} from 'node:http';
import {describe, it, before, after} from 'node:test';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../src/modules/session/SqliteSessionStore.js';
import type {CapturedRequestInput} from '../../../src/modules/session/types.js';
import type {Runtime} from '../../../src/runtime.js';
import {ConsoleServer} from '../../../src/web/ConsoleServer.js';
import type {WsHub} from '../../../src/web/ws/WsHub.js';
import type {SekiroInvoker} from '../../../src/worker/SekiroInvoker.js';
import type {ToolAdapter} from '../../../src/worker/ToolAdapter.js';

function bridgeInput(): CapturedRequestInput {
  return {
    timestamp: 1_700_000_000_000,
    method: 'POST',
    url: 'https://e.dev/api/sign',
    source: 'cdp',
    requestHeaders: '{}',
    requestBody: null,
    statusCode: 200,
    responseHeaders: '{"content-type":"application/json"}',
    responseBody: '{"sign":"abc"}',
    contentType: 'application/json',
    initiator: null,
    durationMs: 0,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
  };
}

describe('ConsoleServer', () => {
  let server: ConsoleServer;
  let actualPort = 0;

  const mockRuntime = {
    browserManager: {
      getContext: () => ({
        pages: () => [],
        browser: () => ({
          version: () => 'Chrome/Mock',
        }),
      }),
      isConnected: () => true,
    },
    hookManager: {
      getStats: () => ({
        totalHooks: 0,
        enabledHooks: 0,
        disabledHooks: 0,
      }),
      getHookStore: () => ({
        events: new EventEmitter(),
      }),
    },
  } as unknown as Runtime;

  const mockInvoker = {
    invoke: async () => ({ok: true}),
  } as unknown as SekiroInvoker;

  const mockToolAdapter = {
    onInvoke: () => () => {
      /* no-op unsubscribe stub */
    },
    executeTool: async () => ({ok: true}),
  } as unknown as ToolAdapter;

  before(async () => {
    server = new ConsoleServer({
      port: 0, // 自动挑选空闲端口
      group: 'test-group',
      rpcHost: 'test-host',
      runtime: mockRuntime,
      invoker: mockInvoker,
      toolAdapter: mockToolAdapter,
    });
    await server.start();
    const addr = (server as any).httpServer.address();
    actualPort = typeof addr === 'string' ? 0 : addr.port;
  });

  after(async () => {
    await server.stop();
  });

  it('serves HTTP API and responds to /api/health', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: actualPort,
          path: '/api/health',
          method: 'GET',
        },
        res => {
          assert.strictEqual(res.statusCode, 200);
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            const body = JSON.parse(data);
            assert.strictEqual(body.success, true);
            assert.strictEqual(body.data.ok, true);
            resolve();
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  });

  it('serves SPA fallback or 404 if file does not exist', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: actualPort,
          path: '/random-web-page-route',
          method: 'GET',
        },
        res => {
          assert.ok(res.statusCode === 200 || res.statusCode === 404);
          resolve();
        },
      );
      req.on('error', reject);
      req.end();
    });
  });

  it('starts and stops without a capture engine', async () => {
    // mockRuntime 没有 captureEngine / captureSessionManager / mitmModule。
    // 本文件顶层的 before()/after() 已经跑过一轮 start()/stop()，
    // 这里再显式跑一次，把「缺失服务不抛」变成一条会红的断言而不是隐含前提。
    const bare = new ConsoleServer({
      port: 0,
      group: 'test-group',
      rpcHost: 'test-host',
      runtime: mockRuntime,
      invoker: mockInvoker,
      toolAdapter: mockToolAdapter,
    });
    await assert.doesNotReject(async () => {
      await bare.start();
      await bare.stop();
    });
  });

  it('bridges session.request summaries to WsHub subscribers', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const capturingRuntime = {
      ...mockRuntime,
      captureSessionManager: manager,
      captureEngine: engine,
    } as unknown as Runtime;

    const srv = new ConsoleServer({
      port: 0,
      group: 'test-group',
      rpcHost: 'test-host',
      runtime: capturingRuntime,
      invoker: mockInvoker,
      toolAdapter: mockToolAdapter,
    });
    await srv.start();
    try {
      const hub = (srv as any).wsHub as WsHub;
      const ws = {
        readyState: 1,
        sent: [] as Array<Record<string, any>>,
        send(data: string) {
          this.sent.push(JSON.parse(data));
        },
        close() {
          this.readyState = 3;
        },
      };
      hub.subscribe(ws as never, 'session.request');

      engine.ingestRequest(bridgeInput());

      assert.strictEqual(ws.sent.length, 1);
      const evt = ws.sent[0]!;
      assert.strictEqual(evt['channel'], 'session.request');
      assert.strictEqual(evt['type'], 'event');
      const payload = evt['payload'] as Record<string, unknown>;
      assert.strictEqual(payload['url'], 'https://e.dev/api/sign');
      assert.strictEqual(payload['source'], 'cdp');
      assert.strictEqual(
        'responseBody' in payload,
        false,
        'spec §8 / R1：WS 只推摘要',
      );
    } finally {
      await srv.stop();
      db.close();
    }
  });

  it('skips the broadcast when nobody subscribed', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const capturingRuntime = {
      ...mockRuntime,
      captureSessionManager: manager,
      captureEngine: engine,
    } as unknown as Runtime;

    const srv = new ConsoleServer({
      port: 0,
      group: 'test-group',
      rpcHost: 'test-host',
      runtime: capturingRuntime,
      invoker: mockInvoker,
      toolAdapter: mockToolAdapter,
    });
    await srv.start();
    try {
      const hub = (srv as any).wsHub as WsHub;
      assert.strictEqual(hub.getSubscriberCount('session.request'), 0);
      // 零订阅者短路：不抛、不序列化、不产生副作用
      assert.doesNotThrow(() => engine.ingestRequest(bridgeInput()));

      const session = manager.getActiveSession();
      assert.ok(session, '短路只影响推送，落库照常');
      assert.strictEqual(manager.getRequests(session.id).length, 1);
    } finally {
      await srv.stop();
      db.close();
    }
  });
});
