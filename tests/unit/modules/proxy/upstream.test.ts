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
import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';
import {MitmProxyServer} from '../../../../src/modules/proxy/MitmProxyServer.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';
import {
  connectHttpProxy,
  connectUpstream,
  formatUpstreamProxy,
  normalizeUpstreamProxy,
  parseNoProxy,
  parseUpstreamProxyUrl,
  shouldBypassUpstream,
} from '../../../../src/modules/proxy/upstream.js';

describe('parseUpstreamProxyUrl', () => {
  it('解析标准 http://host:port', () => {
    const config = parseUpstreamProxyUrl('http://127.0.0.1:8080');
    assert.strictEqual(config.protocol, 'http');
    assert.strictEqual(config.host, '127.0.0.1');
    assert.strictEqual(config.port, 8080);
    assert.strictEqual(config.username, undefined);
    assert.strictEqual(config.password, undefined);
  });

  it('解析 https://host:port', () => {
    const config = parseUpstreamProxyUrl('https://proxy.example.com:8443');
    assert.strictEqual(config.protocol, 'https');
    assert.strictEqual(config.host, 'proxy.example.com');
    assert.strictEqual(config.port, 8443);
  });

  it('解析 SOCKS 协议 (socks5, socks5h, socks)', () => {
    const c1 = parseUpstreamProxyUrl('socks5://127.0.0.1:1080');
    assert.strictEqual(c1.protocol, 'socks5');
    assert.strictEqual(c1.port, 1080);

    const c2 = parseUpstreamProxyUrl('socks5h://10.0.0.1:1081');
    assert.strictEqual(c2.protocol, 'socks5h');
    assert.strictEqual(c2.port, 1081);

    const c3 = parseUpstreamProxyUrl('socks://10.0.0.2:1082');
    assert.strictEqual(c3.protocol, 'socks');
    assert.strictEqual(c3.port, 1082);
  });

  it('端口缺省时回退到各协议默认端口', () => {
    const httpConfig = parseUpstreamProxyUrl('http://proxy.example.com');
    assert.strictEqual(httpConfig.port, 8080);

    const httpsConfig = parseUpstreamProxyUrl('https://proxy.example.com');
    assert.strictEqual(httpsConfig.port, 443);

    const socksConfig = parseUpstreamProxyUrl('socks5://proxy.example.com');
    assert.strictEqual(socksConfig.port, 1080);
  });

  it('缺省协议时默认按 http 补齐', () => {
    const config = parseUpstreamProxyUrl('127.0.0.1:7890');
    assert.strictEqual(config.protocol, 'http');
    assert.strictEqual(config.host, '127.0.0.1');
    assert.strictEqual(config.port, 7890);
  });

  it('支持认证信息及 URL 编码解析', () => {
    const config = parseUpstreamProxyUrl(
      'http://user%40corp:p%40ssword@127.0.0.1:8080',
    );
    assert.strictEqual(config.username, 'user@corp');
    assert.strictEqual(config.password, 'p@ssword');
  });

  it('拒绝非法 URL 或不支持协议', () => {
    assert.throws(() => parseUpstreamProxyUrl(''), /不能为空/);
    assert.throws(
      () => parseUpstreamProxyUrl('ftp://127.0.0.1:21'),
      /不支持的二级代理协议/,
    );
  });
});

describe('normalizeUpstreamProxy & formatUpstreamProxy', () => {
  it('从对象标准化配置', () => {
    const config = normalizeUpstreamProxy({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: 'admin',
      password: 'secret',
      bypassHosts: ['localhost', '*.internal'],
    });
    assert.strictEqual(config.protocol, 'http');
    assert.strictEqual(config.host, '127.0.0.1');
    assert.strictEqual(config.port, 7890);
    assert.deepStrictEqual(config.bypassHosts, ['localhost', '*.internal']);
  });

  it('格式化代理 URL 并支持脱敏', () => {
    const config = parseUpstreamProxyUrl(
      'http://user:secret123@127.0.0.1:8080',
    );
    assert.strictEqual(
      formatUpstreamProxy(config),
      'http://user:secret123@127.0.0.1:8080',
    );
    assert.strictEqual(
      formatUpstreamProxy(config, true),
      'http://user:******@127.0.0.1:8080',
    );
  });
});

describe('shouldBypassUpstream & parseNoProxy', () => {
  it('正确判定主机排除规则', () => {
    const bypass = ['localhost', '127.0.0.1', '*.example.com', '.corp.local'];
    assert.strictEqual(shouldBypassUpstream('localhost', bypass), true);
    assert.strictEqual(shouldBypassUpstream('127.0.0.1', bypass), true);
    assert.strictEqual(shouldBypassUpstream('127.0.0.1:8080', bypass), true);
    assert.strictEqual(shouldBypassUpstream('api.example.com', bypass), true);
    assert.strictEqual(shouldBypassUpstream('sub.corp.local', bypass), true);
    assert.strictEqual(shouldBypassUpstream('google.com', bypass), false);
    assert.strictEqual(shouldBypassUpstream('notexample.com', bypass), false);
  });

  it('解析 NO_PROXY 环境变量格式', () => {
    const res = parseNoProxy('localhost, 127.0.0.1; *.internal');
    assert.deepStrictEqual(res, ['localhost', '127.0.0.1', '*.internal']);
  });
});

describe('connectHttpProxy CONNECT 握手', () => {
  it('通过 HTTP 代理成功建立 CONNECT 隧道并进行数据交互', async () => {
    // 1. 目标服务
    const targetServer = net.createServer(sock => {
      sock.on('data', data => {
        sock.write(`echo:${data.toString()}`);
      });
    });
    await new Promise<void>(r =>
      targetServer.listen(0, '127.0.0.1', () => r()),
    );
    const targetPort = (targetServer.address() as net.AddressInfo).port;

    // 2. Mock HTTP 代理
    let connectMethodCalled = false;
    const httpProxyServer = net.createServer(client => {
      client.once('data', chunk => {
        const text = chunk.toString('utf-8');
        if (text.startsWith('CONNECT')) {
          connectMethodCalled = true;
          const match = text.match(/CONNECT ([^:]+):(\d+) HTTP/);
          assert.ok(match);
          const destHost = match[1];
          const destPort = parseInt(match[2], 10);
          const remote = net.connect(destPort, destHost, () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            client.pipe(remote);
            remote.pipe(client);
          });
          remote.on('error', () => client.destroy());
          client.on('error', () => remote.destroy());
        } else {
          client.destroy();
        }
      });
    });
    await new Promise<void>(r =>
      httpProxyServer.listen(0, '127.0.0.1', () => r()),
    );
    const proxyPort = (httpProxyServer.address() as net.AddressInfo).port;

    try {
      const socket = await connectHttpProxy(
        {protocol: 'http', host: '127.0.0.1', port: proxyPort},
        {host: '127.0.0.1', port: targetPort},
      );

      assert.strictEqual(connectMethodCalled, true);
      const received = await new Promise<string>(resolve => {
        socket.once('data', d => resolve(d.toString()));
        socket.write('hello-http-tunnel');
      });
      assert.strictEqual(received, 'echo:hello-http-tunnel');
      socket.end();
    } finally {
      httpProxyServer.close();
      targetServer.close();
    }
  });

  it('支持 HTTP 代理 Proxy-Authorization 认证', async () => {
    let authHeaderReceived = '';
    const httpProxyServer = net.createServer(client => {
      client.once('data', chunk => {
        const text = chunk.toString('utf-8');
        const authMatch = text.match(
          /Proxy-Authorization:\s*Basic\s+([^\r\n]+)/i,
        );
        if (authMatch) {
          authHeaderReceived = Buffer.from(authMatch[1], 'base64').toString(
            'utf-8',
          );
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        } else {
          client.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
          client.destroy();
        }
      });
    });
    await new Promise<void>(r =>
      httpProxyServer.listen(0, '127.0.0.1', () => r()),
    );
    const proxyPort = (httpProxyServer.address() as net.AddressInfo).port;

    try {
      const socket = await connectHttpProxy(
        {
          protocol: 'http',
          host: '127.0.0.1',
          port: proxyPort,
          username: 'myuser',
          password: 'mypassword',
        },
        {host: 'example.com', port: 80},
      );
      assert.strictEqual(authHeaderReceived, 'myuser:mypassword');
      socket.destroy();
    } finally {
      httpProxyServer.close();
    }
  });

  it('HTTP 代理返回非 2xx 状态码时返回失败', async () => {
    const httpProxyServer = net.createServer(client => {
      client.once('data', () => {
        client.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });
    });
    await new Promise<void>(r =>
      httpProxyServer.listen(0, '127.0.0.1', () => r()),
    );
    const proxyPort = (httpProxyServer.address() as net.AddressInfo).port;

    try {
      await assert.rejects(
        connectHttpProxy(
          {protocol: 'http', host: '127.0.0.1', port: proxyPort},
          {host: 'example.com', port: 80},
        ),
        /上游 HTTP 代理建立隧道失败: HTTP\/1.1 502 Bad Gateway/,
      );
    } finally {
      httpProxyServer.close();
    }
  });

  it('connectUpstream 拒绝不支持的协议', async () => {
    await assert.rejects(
      connectUpstream(
        // @ts-expect-error invalid protocol
        {protocol: 'ftp', host: '127.0.0.1', port: 21},
        {host: 'example.com', port: 80},
      ),
      /不支持的二级代理协议/,
    );
  });
});

describe('MitmProxyServer 与二级外部代理集成', () => {
  it('配置 HTTP upstreamProxy 时 HTTP 请求经由二级外部代理转发并捕获', async () => {
    // 1. Origin Server
    const originServer = http.createServer((_req, res) => {
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('from-origin-via-http-proxy');
    });
    await new Promise<void>(r =>
      originServer.listen(0, '127.0.0.1', () => r()),
    );
    const originPort = (originServer.address() as net.AddressInfo).port;

    // 2. Mock Upstream HTTP Proxy
    let proxyHits = 0;
    const upstreamProxy = net.createServer(client => {
      client.once('data', chunk => {
        const text = chunk.toString('utf-8');
        if (text.startsWith('CONNECT')) {
          proxyHits++;
          const match = text.match(/CONNECT ([^:]+):(\d+) HTTP/);
          assert.ok(match);
          const remote = net.connect(parseInt(match[2], 10), match[1], () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            client.pipe(remote);
            remote.pipe(client);
          });
          remote.on('error', () => client.destroy());
          client.on('error', () => remote.destroy());
        } else {
          client.destroy();
        }
      });
    });
    await new Promise<void>(r =>
      upstreamProxy.listen(0, '127.0.0.1', () => r()),
    );
    const upstreamPort = (upstreamProxy.address() as net.AddressInfo).port;

    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const server = new MitmProxyServer(
      ca,
      exchange => {
        captured = exchange;
      },
      undefined,
      undefined,
      `http://127.0.0.1:${upstreamPort}`,
    );
    await server.start(0);

    try {
      assert.strictEqual(
        server.getUpstreamProxy(),
        `http://127.0.0.1:${upstreamPort}`,
      );

      const targetUrl = `http://127.0.0.1:${originPort}/test-http-proxy`;
      const res = await new Promise<{status: number; body: string}>(
        (resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: server.getPort()!,
              path: targetUrl,
              method: 'GET',
              headers: {host: `127.0.0.1:${originPort}`},
            },
            r => {
              let body = '';
              r.on('data', c => (body += c.toString('utf-8')));
              r.on('end', () => resolve({status: r.statusCode ?? 0, body}));
            },
          );
          req.on('error', reject);
          req.end();
        },
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, 'from-origin-via-http-proxy');
      assert.strictEqual(proxyHits, 1, '请求应实际经由 HTTP 上游代理转发');
      assert.ok(captured);
      assert.strictEqual(captured.url, targetUrl);
    } finally {
      await server.stop();
      upstreamProxy.close();
      originServer.close();
    }
  });

  it('支持在运行时通过 setUpstreamProxy 动态更新或清除二级代理', async () => {
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const server = new MitmProxyServer(ca, () => undefined);

    assert.strictEqual(server.getUpstreamProxy(), null);

    server.setUpstreamProxy('http://127.0.0.1:7890');
    assert.strictEqual(server.getUpstreamProxy(), 'http://127.0.0.1:7890');
    assert.strictEqual(server.getUpstreamConfig()?.protocol, 'http');
    assert.strictEqual(server.getUpstreamConfig()?.port, 7890);

    server.setUpstreamProxy(null);
    assert.strictEqual(server.getUpstreamProxy(), null);
    assert.strictEqual(server.getUpstreamConfig(), null);
  });
});

describe('MitmModule 二级代理配置方法', () => {
  it('支持 setUpstreamProxy 和 getUpstreamProxy', async () => {
    const mod = new MitmModule(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    assert.strictEqual(mod.getUpstreamProxy(), null);

    mod.setUpstreamProxy('socks5://127.0.0.1:1080');
    assert.strictEqual(mod.getUpstreamProxy(), 'socks5://127.0.0.1:1080');

    mod.setUpstreamProxy('http://127.0.0.1:7890');
    assert.strictEqual(mod.getUpstreamProxy(), 'http://127.0.0.1:7890');

    mod.setUpstreamProxy(null);
    assert.strictEqual(mod.getUpstreamProxy(), null);
  });
});
