/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as http from 'node:http';
import type * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';

export interface Socks5Config {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface Socks5Target {
  host: string;
  port: number;
}

const DEFAULT_SOCKS_PORT = 1080;
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

const SOCKS5_ERRORS: Record<number, string> = {
  0x01: 'General SOCKS server failure',
  0x02: 'Connection not allowed by ruleset',
  0x03: 'Network unreachable',
  0x04: 'Host unreachable',
  0x05: 'Connection refused',
  0x06: 'TTL expired',
  0x07: 'Command not supported',
  0x08: 'Address type not supported',
};

/**
 * 解析 SOCKS5 代理 URL。
 * 支持 socks5://, socks5h://, socks:// 协议，支持可选的用户名和密码。
 * 端口缺省时使用 1080。
 */
export function parseSocks5Url(rawUrl: string): Socks5Config {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('SOCKS5 代理 URL 不能为空');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`无效的 SOCKS5 代理 URL: ${rawUrl}`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (
    protocol !== 'socks5:' &&
    protocol !== 'socks5h:' &&
    protocol !== 'socks:'
  ) {
    throw new Error(
      `不支持的代理协议 "${parsed.protocol}"，仅支持 socks5://、socks5h:// 或 socks://`,
    );
  }

  const host = parsed.hostname;
  if (!host) {
    throw new Error(`SOCKS5 代理 URL 缺少 host: ${rawUrl}`);
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : DEFAULT_SOCKS_PORT;
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`SOCKS5 代理端口非法: ${parsed.port}`);
  }

  const config: Socks5Config = {host, port};
  if (parsed.username) {
    config.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    config.password = decodeURIComponent(parsed.password);
  }

  return config;
}

/**
 * 通过 SOCKS5 代理建立到目标服务器的 TCP 连接（RFC 1928 / RFC 1929）。
 */
export function connectSocks5(
  proxy: Socks5Config,
  target: Socks5Target,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const socket = net.connect(proxy.port, proxy.host);

    const cleanup = (): void => {
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
      socket.removeAllListeners('timeout');
      socket.setTimeout(0);
    };

    const fail = (err: Error): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => {
      fail(new Error(`连接上游 SOCKS5 代理超时 (${timeoutMs}ms)`));
    });

    socket.once('error', (err: Error) => {
      fail(
        new Error(
          `连接上游 SOCKS5 代理失败 (${proxy.host}:${proxy.port}): ${err.message}`,
        ),
      );
    });

    socket.once('close', () => {
      fail(new Error('上游 SOCKS5 代理连接在握手完成前已关闭'));
    });

    socket.once('connect', () => {
      let buffer = Buffer.alloc(0);
      let stage: 'greeting' | 'auth' | 'connect' = 'greeting';

      // 1. 发送 Greeting 协商认证方式
      const hasAuth = Boolean(
        proxy.username !== undefined && proxy.password !== undefined,
      );
      if (hasAuth) {
        socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }

      const sendConnectRequest = (): void => {
        stage = 'connect';
        const hostBuf = Buffer.from(target.host, 'utf-8');
        let atyp: number;
        let addrBuf: Buffer;

        if (net.isIPv4(target.host)) {
          atyp = 0x01;
          addrBuf = Buffer.from(
            target.host.split('.').map(x => parseInt(x, 10)),
          );
        } else {
          atyp = 0x03;
          addrBuf = Buffer.concat([Buffer.from([hostBuf.length]), hostBuf]);
        }

        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(target.port, 0);

        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, atyp]),
          addrBuf,
          portBuf,
        ]);
        socket.write(req);
      };

      const handleGreeting = (): void => {
        if (buffer.length < 2) return;
        const ver = buffer[0];
        const method = buffer[1];
        buffer = buffer.subarray(2);

        if (ver !== 0x05) {
          fail(new Error(`不支持的 SOCKS 版本: ${ver}`));
          return;
        }

        if (method === 0xff) {
          fail(new Error('SOCKS5 代理拒绝连接：无支持的认证方式'));
          return;
        }

        if (method === 0x02) {
          if (!hasAuth) {
            fail(new Error('SOCKS5 代理需要用户名密码认证，但未配置凭证'));
            return;
          }
          stage = 'auth';
          const unameBuf = Buffer.from(proxy.username || '', 'utf-8');
          const passBuf = Buffer.from(proxy.password || '', 'utf-8');
          const authReq = Buffer.concat([
            Buffer.from([0x01, unameBuf.length]),
            unameBuf,
            Buffer.from([passBuf.length]),
            passBuf,
          ]);
          socket.write(authReq);
          return;
        }

        if (method === 0x00) {
          sendConnectRequest();
          return;
        }

        fail(new Error(`不支持的 SOCKS5 认证方式: ${method}`));
      };

      const handleAuth = (): void => {
        if (buffer.length < 2) return;
        const authVer = buffer[0];
        const status = buffer[1];
        buffer = buffer.subarray(2);

        if (authVer !== 0x01 || status !== 0x00) {
          fail(new Error(`SOCKS5 用户名密码认证失败 (状态码: ${status})`));
          return;
        }

        sendConnectRequest();
      };

      const handleConnect = (): void => {
        if (buffer.length < 4) return;
        if (buffer[0] !== 0x05) {
          fail(new Error(`不支持的 SOCKS 响应版本: ${buffer[0]}`));
          return;
        }
        const rep = buffer[1];
        const atyp = buffer[3];

        let packetLen = 4;
        if (atyp === 0x01) {
          packetLen += 4 + 2; // IPv4 + port
        } else if (atyp === 0x03) {
          if (buffer.length < 5) return;
          const domainLen = buffer[4];
          packetLen += 1 + domainLen + 2;
        } else if (atyp === 0x04) {
          packetLen += 16 + 2; // IPv6 + port
        } else {
          fail(new Error(`SOCKS5 响应了未知地址类型 ATYP: ${atyp}`));
          return;
        }

        if (buffer.length < packetLen) return;

        if (rep !== 0x00) {
          const desc = SOCKS5_ERRORS[rep] ?? `未知错误代码: ${rep}`;
          fail(
            new Error(
              `SOCKS5 连接目标 ${target.host}:${target.port} 失败: ${desc}`,
            ),
          );
          return;
        }

        // 握手成功
        const extra = buffer.subarray(packetLen);
        cleanup();
        resolved = true;
        if (extra.length > 0) {
          socket.unshift(extra);
        }
        resolve(socket);
      };

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 'greeting') {
          handleGreeting();
        } else if (stage === 'auth') {
          handleAuth();
        } else if (stage === 'connect') {
          handleConnect();
        }
      });
    });
  });
}

/**
 * 为 http.request 创建基于 SOCKS5 代理的异步连接工厂。
 */
export function createSocks5HttpConnector(
  socksConfig: Socks5Config,
  defaultPort = 80,
): (
  opts: http.ClientRequestArgs,
  cb?: (err: Error, socket: net.Socket) => void,
) => net.Socket {
  return (opts, cb): net.Socket => {
    connectSocks5(socksConfig, {
      host: opts.hostname || opts.host || 'localhost',
      port: Number(opts.port) || defaultPort,
    })
      .then(socket => {
        if (cb) {
          // SAFETY: Node ClientRequest oncreate contract expects null as Error when successful.
          cb(null as unknown as Error, socket);
        }
      })
      .catch(err => {
        if (cb) {
          // SAFETY: Node ClientRequest oncreate contract expects socket as second argument.
          cb(
            err instanceof Error ? err : new Error(String(err)),
            undefined as unknown as net.Socket,
          );
        }
      });
    // SAFETY: Node ClientRequest createConnection returns undefined when connection is established asynchronously via oncreate callback.
    return undefined as unknown as net.Socket;
  };
}

/**
 * 为 https.request 创建基于 SOCKS5 代理的异步连接工厂（建立 SOCKS5 隧道后做 TLS 握手）。
 */
export function createSocks5HttpsConnector(
  socksConfig: Socks5Config,
  targetHost: string,
  targetPort: number,
): (
  opts: https.RequestOptions,
  cb?: (err: Error, socket: net.Socket) => void,
) => net.Socket {
  return (opts, cb): net.Socket => {
    connectSocks5(socksConfig, {
      host: opts.hostname || opts.host || targetHost,
      port: Number(opts.port) || targetPort,
    })
      .then(rawSocket => {
        const servername = net.isIP(targetHost)
          ? undefined
          : opts.servername || opts.hostname || targetHost;
        const tlsSocket = tls.connect(
          {
            socket: rawSocket,
            servername,
            rejectUnauthorized: false,
          },
          () => {
            if (cb) {
              // SAFETY: Node ClientRequest oncreate contract expects null as Error when successful.
              cb(null as unknown as Error, tlsSocket);
            }
          },
        );
        tlsSocket.on('error', err => {
          if (cb) {
            // SAFETY: Node ClientRequest oncreate contract expects socket as second argument.
            cb(err, undefined as unknown as net.Socket);
          }
        });
      })
      .catch(err => {
        if (cb) {
          // SAFETY: Node ClientRequest oncreate contract expects socket as second argument.
          cb(
            err instanceof Error ? err : new Error(String(err)),
            undefined as unknown as net.Socket,
          );
        }
      });
    // SAFETY: Node ClientRequest createConnection returns undefined when connection is established asynchronously via oncreate callback.
    return undefined as unknown as net.Socket;
  };
}
