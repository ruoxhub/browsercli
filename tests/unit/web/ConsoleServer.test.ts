/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import {request} from 'node:http';
import {describe, it, before, after} from 'node:test';

import type {Runtime} from '../../../src/runtime.js';
import {ConsoleServer} from '../../../src/web/ConsoleServer.js';
import type {SekiroInvoker} from '../../../src/worker/SekiroInvoker.js';
import type {ToolAdapter} from '../../../src/worker/ToolAdapter.js';

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
    onInvoke: () => () => { /* no-op unsubscribe stub */ },
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
});
