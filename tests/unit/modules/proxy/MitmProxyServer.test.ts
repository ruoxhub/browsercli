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
import {
  MitmProxyServer,
  parseConnectAuthority,
} from '../../../../src/modules/proxy/MitmProxyServer.js';
import {MitmRuleEngine} from '../../../../src/modules/proxy/rewrite.js';
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

/** 大 body 源站：固定 content-length（Node 不切 chunked）。 */
async function startBigOriginServer(sizeBytes: number) {
  return new Promise<{port: number; close: () => Promise<void>}>(
    (resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(sizeBytes),
        });
        res.end(Buffer.alloc(sizeBytes, 'a'));
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

/**
 * 大 body 源站：不设 content-length，分块写（Node 自动切 chunked）。
 * 这条才走「数据期叛逃」路径 —— 少了它，escapeToPipe 零覆盖率。
 */
async function startChunkedBigOriginServer(
  sizeBytes: number,
  chunkBytes: number = 64 * 1024,
) {
  return new Promise<{port: number; close: () => Promise<void>}>(
    (resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, {'content-type': 'text/plain'});
        let sent = 0;
        while (sent < sizeBytes) {
          const n = Math.min(chunkBytes, sizeBytes - sent);
          res.write(Buffer.alloc(n, 'b'));
          sent += n;
        }
        res.end();
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

  it('block 规则（非 444）短路返回状态码且标记 modified', async () => {
    const origin = await startOriginServer();
    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const rules = new MitmRuleEngine();
    rules.addRule({
      id: 'block-1',
      action: {type: 'block', statusCode: 403},
      enabled: true,
      urlFilter: 'block-me',
    });
    const proxy = new MitmProxyServer(
      ca,
      exchange => {
        captured = exchange;
      },
      rules,
    );
    await proxy.start(0);

    try {
      const target = `http://127.0.0.1:${origin.port}/block-me`;
      const res = await requestViaProxy(proxy.getPort()!, target);
      assert.strictEqual(res.status, 403);
      assert.ok(captured, '应产生捕获记录');
      assert.strictEqual(captured.modified, true);
      assert.deepStrictEqual(captured.appliedRuleIds, ['block-1']);
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('modify_body(response) 改写回包且修正 content-length', async () => {
    const origin = await startOriginServer();
    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const rules = new MitmRuleEngine();
    rules.addRule({
      id: 'rb-1',
      action: {
        type: 'modify_body',
        phase: 'response',
        find: 'hello-from-origin',
        replace: 'HELLO-FROM-ORIGIN',
      },
      enabled: true,
    });
    const proxy = new MitmProxyServer(
      ca,
      exchange => {
        captured = exchange;
      },
      rules,
    );
    await proxy.start(0);

    try {
      const target = `http://127.0.0.1:${origin.port}/anything`;
      const res = await requestViaProxy(proxy.getPort()!, target);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, 'HELLO-FROM-ORIGIN');
      assert.ok(captured);
      assert.strictEqual(captured.modified, true);
      assert.strictEqual(captured.responseBody, 'HELLO-FROM-ORIGIN');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('modify_header(response) 在 live-pipe 下增头', async () => {
    const origin = await startOriginServer();
    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const rules = new MitmRuleEngine();
    rules.addRule({
      id: 'hdr-1',
      action: {
        type: 'modify_header',
        phase: 'response',
        set: {'x-hook': '1'},
      },
      enabled: true,
    });
    const proxy = new MitmProxyServer(
      ca,
      exchange => {
        captured = exchange;
      },
      rules,
    );
    await proxy.start(0);

    try {
      const target = `http://127.0.0.1:${origin.port}/anything`;
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.getPort()!,
            path: target,
            method: 'GET',
            headers: {host: new URL(target).host},
          },
          (res: IncomingMessage) => {
            assert.strictEqual(res.headers['x-hook'], '1');
            let b = '';
            res.on('data', c => (b += c.toString('utf-8')));
            res.on('end', () => resolve(b));
          },
        );
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(body, 'hello-from-origin');
      assert.ok(captured);
      assert.strictEqual(captured.modified, true);
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it(
    '>1MB 响应带 content-length 时客户端收满且不挂',
    {timeout: 10000},
    async () => {
      const BIG = 3 * 1024 * 1024;
      const origin = await startBigOriginServer(BIG);
      let captured: CapturedExchange | undefined;
      const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
      await ca.init();
      const rules = new MitmRuleEngine();
      rules.addRule({
        id: 'body-1',
        action: {
          type: 'modify_body',
          phase: 'response',
          find: 'a',
          replace: 'a',
        },
        enabled: true,
      });
      const proxy = new MitmProxyServer(
        ca,
        exchange => {
          captured = exchange;
        },
        rules,
      );
      await proxy.start(0);

      try {
        const target = `http://127.0.0.1:${origin.port}/big`;
        const res = await requestViaProxy(proxy.getPort()!, target);
        assert.strictEqual(res.body.length, BIG, '客户端必须收满 3MB');
        assert.ok(captured, '必须产生 capture 记录');
        assert.strictEqual(captured.truncated, true);
        assert.strictEqual(captured.responseBodySize, BIG);
      } finally {
        await proxy.stop();
        await origin.close();
      }
    },
  );

  it(
    '>1MB chunked 响应叛逃后客户端收满且 capture 保留前 1MB',
    {timeout: 10000},
    async () => {
      const BIG = 3 * 1024 * 1024;
      const origin = await startChunkedBigOriginServer(BIG);
      let captured: CapturedExchange | undefined;
      const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
      await ca.init();
      const rules = new MitmRuleEngine();
      rules.addRule({
        id: 'body-2',
        action: {
          type: 'modify_body',
          phase: 'response',
          find: 'b',
          replace: 'b',
        },
        enabled: true,
      });
      const proxy = new MitmProxyServer(
        ca,
        exchange => {
          captured = exchange;
        },
        rules,
      );
      await proxy.start(0);

      try {
        const target = `http://127.0.0.1:${origin.port}/big`;
        const res = await requestViaProxy(proxy.getPort()!, target);
        assert.strictEqual(res.body.length, BIG, '客户端必须收满 3MB');
        assert.ok(captured, '必须产生 capture 记录');
        assert.strictEqual(captured.truncated, true);
        assert.strictEqual(captured.responseBodySize, BIG);
        assert.strictEqual(
          captured.responseBody?.length,
          1024 * 1024,
          'capture 保留前 1MB 文本（MAX_BODY_SIZE）',
        );
      } finally {
        await proxy.stop();
        await origin.close();
      }
    },
  );

  it(
    '叛逃后 modify_header(response) 仍生效（与 live-pipe 语义一致）',
    {timeout: 10000},
    async () => {
      const BIG = 3 * 1024 * 1024;
      const origin = await startChunkedBigOriginServer(BIG);
      let captured: CapturedExchange | undefined;
      const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
      await ca.init();
      const rules = new MitmRuleEngine();
      rules.addRule({
        id: 'body-escape',
        action: {
          type: 'modify_body',
          phase: 'response',
          find: 'b',
          replace: 'b',
        },
        enabled: true,
      });
      rules.addRule({
        id: 'hdr-escape',
        action: {
          type: 'modify_header',
          phase: 'response',
          set: {'x-escaped': '1'},
        },
        enabled: true,
      });
      const proxy = new MitmProxyServer(
        ca,
        exchange => {
          captured = exchange;
        },
        rules,
      );
      await proxy.start(0);

      try {
        const headers = await new Promise<http.IncomingHttpHeaders>(
          (resolve, reject) => {
            const req = http.request(
              {
                host: '127.0.0.1',
                port: proxy.getPort()!,
                path: `http://127.0.0.1:${origin.port}/big`,
                method: 'GET',
              },
              res => {
                res.resume();
                res.on('end', () => resolve(res.headers));
              },
            );
            req.on('error', reject);
            req.end();
          },
        );
        assert.strictEqual(
          headers['x-escaped'],
          '1',
          '叛逃时 header 改写必须生效',
        );
        assert.ok(captured, '必须产生 capture 记录');
        assert.strictEqual(captured.truncated, true, '必须真正经历了叛逃');
      } finally {
        await proxy.stop();
        await origin.close();
      }
    },
  );

  it('parseConnectAuthority 处理 IPv6 / IPv4 / 裸域名 / 畸形', () => {
    assert.deepStrictEqual(parseConnectAuthority('[240c::1]:8080'), {
      hostname: '240c::1',
      port: 8080,
    });
    assert.deepStrictEqual(parseConnectAuthority('240c::1'), {
      hostname: '240c::1',
      port: 443,
    });
    assert.deepStrictEqual(parseConnectAuthority('[240c'), {
      hostname: '[240c',
      port: 443,
    });
    assert.deepStrictEqual(parseConnectAuthority('192.168.1.1:8080'), {
      hostname: '192.168.1.1',
      port: 8080,
    });
    assert.deepStrictEqual(parseConnectAuthority('example.com'), {
      hostname: 'example.com',
      port: 443,
    });
    assert.strictEqual(parseConnectAuthority(''), null);
  });
});

