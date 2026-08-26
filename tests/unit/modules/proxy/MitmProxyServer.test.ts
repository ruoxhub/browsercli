/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync} from 'node:fs';
import http, {type IncomingMessage} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {CaManager} from '../../../../src/modules/proxy/CaManager.js';
import {MitmProxyServer} from '../../../../src/modules/proxy/MitmProxyServer.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';

/** 启动一个本地真实 HTTP 源站，返回其端口和关闭函数。 */
async function startOriginServer() {
  return new Promise<{port: number; close: () => Promise<void>}>(
    (resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, {'content-type': 'text/plain'});
        res.end('hello-from-origin');
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('bad address'));
          return;
        }
        resolve({
          port: address.port,
          close: () => new Promise<void>(r => server.close(() => r())),
        });
      });
    },
  );
}

function requestViaProxy(
  proxyPort: number,
  targetUrl: string,
): Promise<{status: number | undefined; body: string}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path: targetUrl,
        method: 'GET',
        headers: {host: new URL(targetUrl).host},
      },
      (res: IncomingMessage) => {
        let body = '';
        res.on('data', c => (body += c.toString('utf-8')));
        res.on('end', () => resolve({status: res.statusCode, body}));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('MitmProxyServer', () => {
  it('明文 HTTP 请求被转发并产生捕获记录', async () => {
    const origin = await startOriginServer();
    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(ca, exchange => {
      captured = exchange;
    });
    await proxy.start(0);

    try {
      const target = `http://127.0.0.1:${origin.port}/anything`;
      const res = await requestViaProxy(proxy.getPort()!, target);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, 'hello-from-origin');
      assert.ok(captured, '应产生捕获记录');
      assert.strictEqual(captured.url, target);
      assert.strictEqual(captured.statusCode, 200);
      assert.strictEqual(captured.responseBody, 'hello-from-origin');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('stop 后 isRunning 为 false', async () => {
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(ca, () => undefined);
    await proxy.start(0);
    assert.strictEqual(proxy.isRunning(), true);
    await proxy.stop();
    assert.strictEqual(proxy.isRunning(), false);
  });
});
