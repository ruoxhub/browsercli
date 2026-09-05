/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import net from 'node:net';
import {describe, it} from 'node:test';

import {
  connectSocks5,
  parseSocks5Url,
} from '../../../../src/modules/proxy/socks5.js';

describe('parseSocks5Url', () => {
  it('解析标准 socks5://host:port', () => {
    const config = parseSocks5Url('socks5://127.0.0.1:1080');
    assert.strictEqual(config.host, '127.0.0.1');
    assert.strictEqual(config.port, 1080);
    assert.strictEqual(config.username, undefined);
    assert.strictEqual(config.password, undefined);
  });

  it('端口缺省时回退到默认端口 1080', () => {
    const config = parseSocks5Url('socks5://proxy.example.com');
    assert.strictEqual(config.host, 'proxy.example.com');
    assert.strictEqual(config.port, 1080);
  });

  it('支持 socks5h:// 和 socks:// 协议头', () => {
    const c1 = parseSocks5Url('socks5h://10.0.0.1:8080');
    assert.strictEqual(c1.host, '10.0.0.1');
    assert.strictEqual(c1.port, 8080);

    const c2 = parseSocks5Url('socks://10.0.0.2:9090');
    assert.strictEqual(c2.host, '10.0.0.2');
    assert.strictEqual(c2.port, 9090);
  });

  it('支持用户名与密码凭证及 URL 解码', () => {
    const config = parseSocks5Url('socks5://user%40name:p%40ss@127.0.0.1:1080');
    assert.strictEqual(config.host, '127.0.0.1');
    assert.strictEqual(config.port, 1080);
    assert.strictEqual(config.username, 'user@name');
    assert.strictEqual(config.password, 'p@ss');
  });

  it('拒绝非 SOCKS 协议或非法 URL', () => {
    assert.throws(
      () => parseSocks5Url('http://127.0.0.1:8080'),
      /不支持的代理协议/,
    );
    assert.throws(() => parseSocks5Url(''), /不能为空/);
    assert.throws(() => parseSocks5Url('not-a-url'), /无效的 SOCKS5 代理 URL/);
  });
});

describe('connectSocks5 握手连接', () => {
  it('无认证握手成功并建立到目标的双向通信', async () => {
    // 1. 创建目标 echo 服务
    const targetServer = net.createServer(sock => {
      sock.on('data', data => {
        sock.write(`echo:${data.toString()}`);
      });
    });
    await new Promise<void>(resolve =>
      targetServer.listen(0, '127.0.0.1', () => resolve()),
    );
    const targetPort = (targetServer.address() as net.AddressInfo).port;

    // 2. 创建 mock SOCKS5 服务（无认证）
    const socksServer = net.createServer(client => {
      let stage = 0;
      let remote: net.Socket | null = null;
      client.on('data', data => {
        if (stage === 0) {
          assert.strictEqual(data[0], 0x05);
          client.write(Buffer.from([0x05, 0x00])); // 无需认证
          stage = 1;
        } else if (stage === 1) {
          assert.strictEqual(data[0], 0x05);
          assert.strictEqual(data[1], 0x01); // CONNECT
          let destHost = '';
          let destPort = 0;
          const atyp = data[3];
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
    await new Promise<void>(resolve =>
      socksServer.listen(0, '127.0.0.1', () => resolve()),
    );
    const socksPort = (socksServer.address() as net.AddressInfo).port;

    try {
      const socket = await connectSocks5(
        {host: '127.0.0.1', port: socksPort},
        {host: '127.0.0.1', port: targetPort},
      );

      const received = await new Promise<string>(resolve => {
        socket.once('data', d => resolve(d.toString()));
        socket.write('ping');
      });

      assert.strictEqual(received, 'echo:ping');
      socket.end();
    } finally {
      socksServer.close();
      targetServer.close();
    }
  });

  it('支持 RFC 1929 用户名密码认证', async () => {
    const socksServer = net.createServer(client => {
      let stage = 0;
      client.on('data', data => {
        if (stage === 0) {
          // 期望客户端提供认证方法
          client.write(Buffer.from([0x05, 0x02])); // 选定 0x02 (username/password)
          stage = 1;
        } else if (stage === 1) {
          // 验证 RFC 1929 报文
          assert.strictEqual(data[0], 0x01);
          const ulen = data[1];
          const user = data.subarray(2, 2 + ulen).toString();
          const plen = data[2 + ulen];
          const pass = data.subarray(3 + ulen, 3 + ulen + plen).toString();
          if (user === 'admin' && pass === 'secret') {
            client.write(Buffer.from([0x01, 0x00])); // 认证成功
            stage = 2;
          } else {
            client.write(Buffer.from([0x01, 0x01])); // 认证失败
            client.destroy();
          }
        } else if (stage === 2) {
          // CONNECT 响应成功
          client.write(
            Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x12, 0x34]),
          );
          stage = 3;
        }
      });
    });
    await new Promise<void>(resolve =>
      socksServer.listen(0, '127.0.0.1', () => resolve()),
    );
    const socksPort = (socksServer.address() as net.AddressInfo).port;

    try {
      // 凭据正确
      const socket = await connectSocks5(
        {
          host: '127.0.0.1',
          port: socksPort,
          username: 'admin',
          password: 'secret',
        },
        {host: '127.0.0.1', port: 80},
      );
      assert.ok(socket);
      socket.end();

      // 凭据错误
      await assert.rejects(
        () =>
          connectSocks5(
            {
              host: '127.0.0.1',
              port: socksPort,
              username: 'admin',
              password: 'wrong',
            },
            {host: '127.0.0.1', port: 80},
          ),
        /认证失败/,
      );
    } finally {
      socksServer.close();
    }
  });

  it('当 SOCKS5 服务器返回非 0 状态码时抛出可读错误', async () => {
    const socksServer = net.createServer(client => {
      let stage = 0;
      client.on('data', () => {
        if (stage === 0) {
          client.write(Buffer.from([0x05, 0x00]));
          stage = 1;
        } else if (stage === 1) {
          // 返回 0x05: Connection refused
          client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.destroy();
        }
      });
    });
    await new Promise<void>(resolve =>
      socksServer.listen(0, '127.0.0.1', () => resolve()),
    );
    const socksPort = (socksServer.address() as net.AddressInfo).port;

    try {
      await assert.rejects(
        () =>
          connectSocks5(
            {host: '127.0.0.1', port: socksPort},
            {host: 'target.local', port: 80},
          ),
        /Connection refused/,
      );
    } finally {
      socksServer.close();
    }
  });
});
