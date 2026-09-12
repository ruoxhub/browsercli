/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as http from 'node:http';
import type * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';

import {connectSocks5, type Socks5Config} from './socks5.js';

export type UpstreamProxyProtocol =
  | 'http'
  | 'https'
  | 'socks5'
  | 'socks5h'
  | 'socks';

export interface UpstreamProxyConfig {
  protocol: UpstreamProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** 可选：不走二级代理的目标主机列表（支持通配符如 *.local, .corp.net 等） */
  bypassHosts?: string[];
  /** 连接超时时间（毫秒，默认 15000） */
  timeoutMs?: number;
}

export interface UpstreamTarget {
  host: string;
  port: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

function getDefaultPortForProtocol(protocol: UpstreamProxyProtocol): number {
  switch (protocol) {
    case 'https':
      return 443;
    case 'socks5':
    case 'socks5h':
    case 'socks':
      return 1080;
    case 'http':
    default:
      return 8080;
  }
}

/**
 * 解析二级外部代理 URL。
 * 支持 http://, https://, socks5://, socks5h://, socks:// 协议，支持可选用户名和密码。
 * 如果未提供协议头，默认按 http:// 解析。
 */
export function parseUpstreamProxyUrl(rawUrl: string): UpstreamProxyConfig {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('二级代理 URL 不能为空');
  }

  const urlWithScheme = /^[a-zA-Z0-9+-.]+:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(urlWithScheme);
  } catch {
    throw new Error(`无效的二级代理 URL: ${rawUrl}`);
  }

  const rawProtocol = parsed.protocol.toLowerCase().replace(/:$/, '');
  const validProtocols: UpstreamProxyProtocol[] = [
    'http',
    'https',
    'socks5',
    'socks5h',
    'socks',
  ];

  if (!validProtocols.includes(rawProtocol as UpstreamProxyProtocol)) {
    throw new Error(
      `不支持的二级代理协议 "${parsed.protocol}"，仅支持 http://、https://、socks5://、socks5h:// 或 socks://`,
    );
  }

  const protocol = rawProtocol as UpstreamProxyProtocol;
  const host = parsed.hostname;
  if (!host) {
    throw new Error(`二级代理 URL 缺少 host: ${rawUrl}`);
  }

  const port = parsed.port
    ? parseInt(parsed.port, 10)
    : getDefaultPortForProtocol(protocol);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`二级代理端口非法: ${parsed.port}`);
  }

  const config: UpstreamProxyConfig = {
    protocol,
    host,
    port,
  };

  if (parsed.username) {
    config.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    config.password = decodeURIComponent(parsed.password);
  }

  return config;
}

/**
 * 标准化二级代理配置，支持字符串 URL 或结构化配置对象。
 */
export function normalizeUpstreamProxy(
  input: string | UpstreamProxyConfig,
): UpstreamProxyConfig {
  if (typeof input === 'string') {
    return parseUpstreamProxyUrl(input);
  }

  if (typeof input !== 'object' || input === null) {
    throw new Error('二级代理配置必须是 URL 字符串或配置对象');
  }

  const protocol = (
    input.protocol || 'http'
  ).toLowerCase() as UpstreamProxyProtocol;
  const validProtocols: UpstreamProxyProtocol[] = [
    'http',
    'https',
    'socks5',
    'socks5h',
    'socks',
  ];
  if (!validProtocols.includes(protocol)) {
    throw new Error(
      `不支持的二级代理协议 "${input.protocol}"，仅支持 http、https、socks5、socks5h、socks`,
    );
  }

  const host = input.host?.trim();
  if (!host) {
    throw new Error('二级代理配置缺少 host');
  }

  const port =
    typeof input.port === 'number'
      ? input.port
      : getDefaultPortForProtocol(protocol);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`二级代理端口非法: ${input.port}`);
  }

  return {
    protocol,
    host,
    port,
    username: input.username,
    password: input.password,
    bypassHosts: input.bypassHosts ? [...input.bypassHosts] : undefined,
    timeoutMs: input.timeoutMs,
  };
}

/**
 * 格式化输出二级代理 URL。
 */
export function formatUpstreamProxy(
  config: UpstreamProxyConfig,
  maskPassword = false,
): string {
  const proto = config.protocol || 'http';
  let auth = '';
  if (config.username) {
    const user = encodeURIComponent(config.username);
    if (config.password) {
      const pass = maskPassword
        ? '******'
        : encodeURIComponent(config.password);
      auth = `${user}:${pass}@`;
    } else {
      auth = `${user}@`;
    }
  }
  return `${proto}://${auth}${config.host}:${config.port}`;
}

/**
 * 脱敏字符串形式的上游代理 URL 中的密码部分（user:pass@ → user:******@）。
 * 非 URL / 无凭证时原样返回。
 */
export function maskUpstreamUrl(raw: string): string {
  return raw.replace(/:\/\/([^/@:]+):([^/@]+)@/, '://$1:******@');
}

/**
 * 解析 NO_PROXY / no_proxy 环境变量为排除主机列表。
 */
export function parseNoProxy(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 判定目标主机是否绕过二级外部代理。
 */
export function shouldBypassUpstream(
  targetHost: string,
  bypassHosts?: string[],
): boolean {
  if (!bypassHosts || bypassHosts.length === 0) return false;
  const normalizedTarget = targetHost.toLowerCase().trim();
  // 裸 IPv6（如 2001:db8::1）含 ':' 但不是 host:port，不能用 split(':')[0] 截断。
  const bareIpv6 = net.isIP(normalizedTarget) === 6;
  const hostWithoutPort =
    !bareIpv6 &&
    normalizedTarget.includes(':') &&
    !normalizedTarget.includes(']')
      ? (normalizedTarget.split(':')[0] ?? normalizedTarget)
      : normalizedTarget.replace(/^\[(.*)\]$/, '$1');

  for (const rawItem of bypassHosts) {
    const item = rawItem.toLowerCase().trim();
    if (!item) continue;
    if (item === '*') return true;
    if (item === hostWithoutPort || item === normalizedTarget) return true;
    if (item.startsWith('*.')) {
      const suffix = item.slice(1);
      if (
        hostWithoutPort.endsWith(suffix) ||
        hostWithoutPort === item.slice(2)
      ) {
        return true;
      }
    } else if (item.startsWith('.')) {
      if (hostWithoutPort.endsWith(item) || hostWithoutPort === item.slice(1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 通过 HTTP/HTTPS CONNECT 隧道连接到目标主机。
 */
export function connectHttpProxy(
  proxy: UpstreamProxyConfig,
  target: UpstreamTarget,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const isHttps = proxy.protocol === 'https';
    let socket: net.Socket;
    if (isHttps) {
      const servername = net.isIP(proxy.host) ? undefined : proxy.host;
      socket = tls.connect({
        host: proxy.host,
        port: proxy.port,
        servername,
        rejectUnauthorized: false,
      });
    } else {
      socket = net.connect(proxy.port, proxy.host);
    }

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
      fail(new Error(`连接上游 HTTP 代理超时 (${timeoutMs}ms)`));
    });
    socket.once('error', (err: Error) => {
      fail(
        new Error(
          `连接上游 HTTP 代理失败 (${proxy.host}:${proxy.port}): ${err.message}`,
        ),
      );
    });
    socket.once('close', () => {
      fail(
        new Error(
          `与上游 HTTP 代理的连接意外关闭 (${proxy.host}:${proxy.port})`,
        ),
      );
    });

    const onConnected = (): void => {
      let req =
        `CONNECT ${target.host}:${target.port} HTTP/1.1\r\n` +
        `Host: ${target.host}:${target.port}\r\n` +
        `Proxy-Connection: Keep-Alive\r\n`;

      if (proxy.username !== undefined) {
        const pass = proxy.password ?? '';
        const creds = Buffer.from(
          `${proxy.username}:${pass}`,
          'utf-8',
        ).toString('base64');
        req += `Proxy-Authorization: Basic ${creds}\r\n`;
      }
      req += '\r\n';

      socket.write(req);

      let responseBuffer = Buffer.alloc(0);

      const onData = (chunk: Buffer): void => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        const headerEndIdx = responseBuffer.indexOf('\r\n\r\n');
        if (headerEndIdx === -1) {
          if (responseBuffer.length > 32 * 1024) {
            fail(new Error('上游 HTTP 代理响应头过大'));
          }
          return;
        }

        const headerStr = responseBuffer
          .subarray(0, headerEndIdx)
          .toString('utf-8');
        const statusLine = headerStr.split('\r\n')[0] ?? '';
        const match = statusLine.match(/^HTTP\/[0-9.]+\s+(\d+)\s*(.*)/i);
        const statusCode = match ? parseInt(match[1], 10) : 0;

        if (statusCode < 200 || statusCode >= 300) {
          fail(
            new Error(
              `上游 HTTP 代理建立隧道失败: ${statusLine.trim() || `HTTP ${statusCode}`}`,
            ),
          );
          return;
        }

        resolved = true;
        cleanup();

        const excess = responseBuffer.subarray(headerEndIdx + 4);
        if (excess.length > 0) {
          socket.unshift(excess);
        }
        resolve(socket);
      };

      socket.on('data', onData);
    };

    if (isHttps) {
      (socket as tls.TLSSocket).once('secureConnect', onConnected);
    } else {
      socket.once('connect', onConnected);
    }
  });
}

/**
 * 统一连接二级外部代理（分发至 HTTP CONNECT 或 SOCKS5）。
 */
export function connectUpstream(
  proxy: UpstreamProxyConfig,
  target: UpstreamTarget,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<net.Socket> {
  const proto = proxy.protocol?.toLowerCase();
  if (proto === 'http' || proto === 'https') {
    return connectHttpProxy(proxy, target, timeoutMs);
  }
  if (proto === 'socks5' || proto === 'socks5h' || proto === 'socks') {
    const socksConfig: Socks5Config = {
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
    };
    return connectSocks5(socksConfig, target, timeoutMs);
  }
  return Promise.reject(new Error(`不支持的二级代理协议: ${proxy.protocol}`));
}

/**
 * 为 http.request 创建基于二级外部代理的连接工厂。
 */
export function createUpstreamHttpConnector(
  proxy: UpstreamProxyConfig,
  defaultPort = 80,
): (
  opts: http.ClientRequestArgs,
  cb?: (err: Error, socket: net.Socket) => void,
) => net.Socket {
  return (opts, cb): net.Socket => {
    const host = opts.hostname || opts.host || 'localhost';
    const port = Number(opts.port) || defaultPort;

    if (shouldBypassUpstream(host, proxy.bypassHosts)) {
      const socket = net.connect(port, host, () => {
        if (cb) {
          // SAFETY: Node ClientRequest oncreate contract expects null as Error when successful.
          cb(null as unknown as Error, socket);
        }
      });
      socket.on('error', err => {
        if (cb) {
          // SAFETY: Node ClientRequest oncreate contract expects socket as second argument.
          cb(err, undefined as unknown as net.Socket);
        }
      });
      // SAFETY: Node ClientRequest createConnection returns undefined when connection is established asynchronously via oncreate callback.
      return undefined as unknown as net.Socket;
    }

    connectUpstream(proxy, {host, port}, proxy.timeoutMs)
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
 * 为 https.request 创建基于二级外部代理的连接工厂（通过代理隧道后做 TLS 握手）。
 */
export function createUpstreamHttpsConnector(
  proxy: UpstreamProxyConfig,
  targetHost: string,
  targetPort: number,
): (
  opts: https.RequestOptions,
  cb?: (err: Error, socket: net.Socket) => void,
) => net.Socket {
  return (opts, cb): net.Socket => {
    const host = opts.hostname || opts.host || targetHost;
    const port = Number(opts.port) || targetPort;

    const wrapTls = (rawSocket: net.Socket): void => {
      const servername = net.isIP(host)
        ? undefined
        : opts.servername || opts.hostname || host;
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
    };

    if (shouldBypassUpstream(host, proxy.bypassHosts)) {
      const rawSocket = net.connect(port, host, () => {
        wrapTls(rawSocket);
      });
      rawSocket.on('error', err => {
        if (cb) {
          // SAFETY: Node ClientRequest oncreate contract expects socket as second argument.
          cb(err, undefined as unknown as net.Socket);
        }
      });
      // SAFETY: Node ClientRequest createConnection returns undefined when connection is established asynchronously via oncreate callback.
      return undefined as unknown as net.Socket;
    }

    connectUpstream(proxy, {host, port}, proxy.timeoutMs)
      .then(rawSocket => {
        wrapTls(rawSocket);
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
