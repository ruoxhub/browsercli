/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {CaManager} from '../../../../src/modules/proxy/CaManager.js';
import {MitmProxyServer} from '../../../../src/modules/proxy/MitmProxyServer.js';
import type {ProcessConnectionTracker} from '../../../../src/modules/proxy/ProcessConnectionTracker.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';

/** 端口 → 进程 映射完全可控的 mock tracker。 */
function makeTracker(mapping: Record<number, {pid: number; name: string}>) {
  return {
    getProcessByPortSync: (port: number) => mapping[port] ?? null,
  } as unknown as ProcessConnectionTracker;
}

async function startOrigin(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('ok');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string')
        return reject(new Error('addr'));
      resolve({
        port: addr.port,
        close: () => new Promise<void>(r => server.close(() => r())),
      });
    });
  });
}

describe('MitmProxyServer local-apps 分流', () => {
  it('非目标进程的 CONNECT 走盲转发：无 capture、无证书', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const config = {
      enabled: true,
      targets: ['wechat.exe'],
      systemProxyActive: true,
    };
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}), // 所有端口都查不到进程 → null
      () => config,
    );
    await proxy.start(0);
    try {
      const established = await new Promise<boolean>(resolve => {
        const socket = net.connect(proxy.getPort()!, '127.0.0.1', () => {
          socket.write(
            `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n`,
          );
        });
        let buf = '';
        socket.on('data', d => {
          buf += d.toString('utf-8');
          if (buf.includes('200 Connection Established')) {
            socket.destroy();
            resolve(true);
          }
        });
        socket.on('error', () => resolve(false));
        socket.setTimeout(5000, () => {
          socket.destroy();
          resolve(false);
        });
      });
      assert.strictEqual(established, true, '盲转发也要回 200');
      assert.strictEqual(captured.length, 0, '不得产生 capture');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('全选模式（targets 为空）反查失败也放行解密链路', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}), // 反查全 null
      () => ({enabled: true, targets: [], systemProxyActive: true}),
    );
    await proxy.start(0);
    try {
      // 明文 HTTP 请求：全选模式应正常转发并 capture
      const res = await new Promise<{status: number; body: string}>(
        (resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: proxy.getPort()!,
              path: `http://127.0.0.1:${origin.port}/`,
              method: 'GET',
              headers: {host: `127.0.0.1:${origin.port}`},
            },
            r => {
              let body = '';
              r.on('data', (c: Buffer) => (body += c.toString()));
              r.on('end', () => resolve({status: r.statusCode ?? 0, body}));
            },
          );
          req.on('error', reject);
          req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('timeout'));
          });
          req.end();
        },
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(captured.length, 1);
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('非目标进程的明文 HTTP 请求：转发但不落库', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}), // null → 非目标
      () => ({enabled: true, targets: ['wechat.exe'], systemProxyActive: true}),
    );
    await proxy.start(0);
    try {
      const res = await new Promise<{status: number}>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.getPort()!,
            path: `http://127.0.0.1:${origin.port}/`,
            method: 'GET',
            headers: {host: `127.0.0.1:${origin.port}`},
          },
          r => resolve({status: r.statusCode ?? 0}),
        );
        req.on('error', reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.end();
      });
      assert.strictEqual(res.status, 200, '请求本身要成功');
      assert.strictEqual(captured.length, 0, '不落库');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('config.enabled=false 时不分流，一切如旧', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}),
      () => ({enabled: false, targets: ['x.exe'], systemProxyActive: false}),
    );
    await proxy.start(0);
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.getPort()!,
            path: `http://127.0.0.1:${origin.port}/`,
            method: 'GET',
            headers: {host: `127.0.0.1:${origin.port}`},
          },
          () => resolve(),
        );
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(captured.length, 1, '关闭时正常 capture');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('配置上游 SOCKS5 时，非目标进程盲转发必须经 SOCKS5 隧道而非直连（P0-1 回归）', async () => {
    const origin = await startOrigin();
    let socksSawConnect = false;
    // mock SOCKS5 服务器（模式抄 socks5.test.ts:60-130）
    const socksServer = net.createServer(client => {
      let stage = 0;
      let remote: net.Socket | null = null;
      client.on('data', data => {
        if (stage === 0) {
          client.write(Buffer.from([0x05, 0x00]));
          stage = 1;
        } else if (stage === 1) {
          socksSawConnect = true;
          const atyp = data[3];
          let destHost = '';
          let destPort = 0;
          if (atyp === 0x01) {
            destHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
            destPort = data.readUInt16BE(8);
          } else if (atyp === 0x03) {
            const len = data[4];
            destHost = data.subarray(5, 5 + len).toString();
            destPort = data.readUInt16BE(5 + len);
          }
          remote = net.connect(destPort, destHost, () => {
            client.write(
              Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x12, 0x34]),
            );
            stage = 2;
            client.pipe(remote!);
            remote!.pipe(client);
          });
          remote.on('error', () => client.destroy());
          client.on('error', () => remote?.destroy());
        }
      });
    });
    await new Promise<void>(r => socksServer.listen(0, '127.0.0.1', () => r()));
    const socksPort = (socksServer.address() as net.AddressInfo).port;

    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      `socks5://127.0.0.1:${socksPort}`,
      makeTracker({}), // 反查 null → 非目标
      () => ({enabled: true, targets: ['wechat.exe'], systemProxyActive: true}),
    );
    await proxy.start(0);
    try {
      const established = await new Promise<boolean>(resolve => {
        const socket = net.connect(proxy.getPort()!, '127.0.0.1', () => {
          socket.write(
            `CONNECT 127.0.0.1:${origin.port} HTTP/1.1\r\nHost: 127.0.0.1:${origin.port}\r\n\r\n`,
          );
        });
        let buf = '';
        socket.on('data', d => {
          buf += d.toString('utf-8');
          if (buf.includes('200 Connection Established')) {
            socket.destroy();
            resolve(true);
          }
        });
        socket.on('error', () => resolve(false));
        socket.setTimeout(5000, () => {
          socket.destroy();
          resolve(false);
        });
      });
      assert.strictEqual(established, true);
      assert.strictEqual(socksSawConnect, true, '必须经 SOCKS5 隧道');
      assert.strictEqual(captured.length, 0);
    } finally {
      await proxy.stop();
      socksServer.close();
      await origin.close();
    }
  });
});
