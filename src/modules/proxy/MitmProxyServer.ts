/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 移植自 anything-analyzer (MIT License):
 * open-source/anything-analyzer/src/main/proxy/mitm-proxy-server.ts
 * 裁剪：上游代理（SOCKS5/HTTP 上游）、证书下载页、uuid 依赖、EventEmitter。
 */
import {randomUUID} from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as url from 'node:url';
import {brotliDecompressSync, gunzipSync, inflateSync} from 'node:zlib';

import {logger} from '../../utils/logger.js';

import type {CaManager} from './CaManager.js';
import type {CapturedExchange} from './types.js';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const BINARY_CONTENT_TYPES = [
  'image/',
  'font/',
  'audio/',
  'video/',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
];
const STATIC_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|map)$/i;

function headerToString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',') : value || '';
}

function decodeCapturedBody(
  body: Buffer,
  contentEncoding: string | string[] | undefined,
): Buffer {
  const encodings = headerToString(contentEncoding)
    .toLowerCase()
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

  return encodings.reduceRight((decoded, encoding) => {
    if (encoding === 'br') return brotliDecompressSync(decoded);
    if (encoding === 'gzip' || encoding === 'x-gzip')
      return gunzipSync(decoded);
    if (encoding === 'deflate') return inflateSync(decoded);
    return decoded;
  }, body);
}

function bodyToUtf8(
  body: Buffer,
  contentEncoding: string | string[] | undefined,
): string {
  try {
    return decodeCapturedBody(body, contentEncoding)
      .toString('utf-8')
      .substring(0, MAX_BODY_SIZE);
  } catch {
    return body.toString('utf-8').substring(0, MAX_BODY_SIZE);
  }
}

function parseRawHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = raw.split('\r\n').slice(1);
  for (const line of lines) {
    if (!line) break;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

/**
 * MitmProxyServer — 嵌入式 HTTP/HTTPS 中间人代理。
 *
 * - 明文 HTTP 直接转发。
 * - HTTPS CONNECT 通过 CaManager 动态签证书拦截并解密。
 * - WS / WSS 流量隧道转发，不解密。
 * - 每个完成的事务通过 onCaptured 回调对外产生 CapturedExchange。
 */
export class MitmProxyServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly connections = new Set<net.Socket>();

  constructor(
    private readonly caManager: CaManager,
    private readonly onCaptured: (exchange: CapturedExchange) => void,
  ) {}

  async start(port: number): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });
    this.server.on('connect', (req, clientSocket, head) => {
      this.handleConnect(req, clientSocket as net.Socket, head);
    });
    this.server.on('upgrade', (req, socket, head) => {
      this.handleWsUpgrade(req, socket as net.Socket, head, false);
    });
    this.server.on('connection', socket => {
      this.connections.add(socket);
      socket.on('close', () => this.connections.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        logger.error('[MitmProxy] Server error:', err.message);
        reject(err);
      });
      this.server!.listen(port, '0.0.0.0', () => {
        const address = this.server!.address();
        this.port =
          address && typeof address === 'object' ? address.port : port;
        logger.info(`[MitmProxy] Listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    await new Promise<void>(resolve => {
      this.server!.close(() => {
        logger.info('[MitmProxy] Stopped');
        this.server = null;
        this.port = null;
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  getPort(): number | null {
    return this.port;
  }

  // ── HTTP（非 CONNECT）──

  private handleHttpRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const targetUrl = clientReq.url || '';
    if (!targetUrl) {
      clientRes.writeHead(400);
      clientRes.end('Bad Request');
      return;
    }
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const parsed = url.parse(targetUrl);
    const reqBodyChunks: Buffer[] = [];
    let reqBodySize = 0;

    clientReq.on('data', (chunk: Buffer) => {
      if (reqBodySize < MAX_BODY_SIZE) reqBodyChunks.push(chunk);
      reqBodySize += chunk.length;
    });

    clientReq.on('end', () => {
      const reqBody = Buffer.concat(reqBodyChunks);
      const headers = {...clientReq.headers};
      delete headers['proxy-connection'];

      const options: http.RequestOptions = {
        hostname: parsed.hostname ?? 'localhost',
        port: parseInt(parsed.port ?? '80', 10),
        path: parsed.path ?? '/',
        method: clientReq.method,
        headers,
      };

      const proxyReq = http.request(options, proxyRes => {
        this.relayResponse(
          requestId,
          startTime,
          clientReq,
          reqBody,
          targetUrl,
          proxyRes,
          clientRes,
        );
      });

      proxyReq.on('error', (err: Error) => {
        logger.warn('[MitmProxy] HTTP proxy error:', err.message);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Bad Gateway');
        }
      });

      if (reqBody.length > 0) proxyReq.write(reqBody);
      proxyReq.end();
    });
  }

  // ── 明文 ws:// upgrade ──

  private handleWsUpgrade(
    clientReq: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
    isTls: boolean,
  ): void {
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const targetUrl = clientReq.url || '/';
    const parsed = url.parse(targetUrl);
    const hostname = parsed.hostname || 'localhost';
    const port = parseInt(parsed.port || (isTls ? '443' : '80'), 10);
    const scheme = isTls ? 'wss' : 'ws';
    const fullUrl = targetUrl.startsWith('ws')
      ? targetUrl
      : `${scheme}://${hostname}:${port}${parsed.path || '/'}`;

    const connectAndTunnel = (serverSocket: net.Socket): void => {
      const hostHeader =
        port !== (isTls ? 443 : 80) ? `${hostname}:${port}` : hostname;
      const headers = {...clientReq.headers, host: hostHeader};
      let rawReq = `${clientReq.method} ${parsed.path || '/'} HTTP/1.1\r\n`;
      for (const [key, val] of Object.entries(headers)) {
        if (val === undefined) continue;
        for (const v of Array.isArray(val) ? val : [val]) {
          rawReq += `${key}: ${v}\r\n`;
        }
      }
      rawReq += '\r\n';

      serverSocket.write(rawReq);
      if (head.length > 0) serverSocket.write(head);

      let responseBuf = Buffer.alloc(0);
      const onData = (chunk: Buffer): void => {
        responseBuf = Buffer.concat([responseBuf, chunk]);
        const headerEnd = responseBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        serverSocket.removeListener('data', onData);

        const responseHeader = responseBuf.subarray(0, headerEnd + 4);
        const trailing = responseBuf.subarray(headerEnd + 4);
        const firstLine = responseHeader.toString('utf-8').split('\r\n')[0];
        const statusCode = parseInt(firstLine.split(' ')[1], 10) || 101;

        clientSocket.write(responseHeader);
        if (trailing.length > 0) clientSocket.write(trailing);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
        serverSocket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => serverSocket.destroy());
        serverSocket.on('close', () => clientSocket.destroy());
        clientSocket.on('close', () => serverSocket.destroy());

        this.onCaptured({
          requestId,
          method: clientReq.method || 'GET',
          url: fullUrl,
          requestHeaders: this.headersToRecord(clientReq.headers),
          requestBody: null,
          statusCode,
          responseHeaders: parseRawHeaders(responseHeader.toString('utf-8')),
          responseBody: null,
          contentType: null,
          isOptions: false,
          isStatic: false,
          isStreaming: false,
          isWebSocket: true,
          truncated: false,
          timestamp: startTime,
        });
      };
      serverSocket.on('data', onData);
    };

    const serverSocket = net.connect(port, hostname, () =>
      connectAndTunnel(serverSocket),
    );
    serverSocket.on('error', (err: Error) => {
      logger.warn(`[MitmProxy] WS connect error for ${hostname}:`, err.message);
      clientSocket.destroy();
    });
  }

  // ── HTTPS CONNECT 拦截 ──

  private handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): void {
    const [hostname, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr, 10) || 443;

    if (!hostname) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    const secureContext = this.caManager.getSecureContextForHost(hostname);
    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext,
    });

    if (head.length > 0) tlsSocket.unshift(head);

    const miniServer = http.createServer((decryptedReq, decryptedRes) => {
      this.handleDecryptedRequest(hostname, port, decryptedReq, decryptedRes);
    });
    miniServer.on('upgrade', (upgradeReq, upgradeSocket, upgradeHead) => {
      this.handleWsUpgrade(
        upgradeReq,
        upgradeSocket as net.Socket,
        upgradeHead,
        true,
      );
    });
    miniServer.emit('connection', tlsSocket as unknown as net.Socket);

    tlsSocket.on('error', (err: Error) => {
      logger.warn(`[MitmProxy] TLS error for ${hostname}:`, err.message);
    });
    clientSocket.on('error', () => tlsSocket.destroy());
  }

  private handleDecryptedRequest(
    hostname: string,
    port: number,
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const fullUrl = `https://${hostname}${port !== 443 ? ':' + port : ''}${clientReq.url || '/'}`;

    const reqBodyChunks: Buffer[] = [];
    let reqBodySize = 0;
    clientReq.on('data', (chunk: Buffer) => {
      if (reqBodySize < MAX_BODY_SIZE) reqBodyChunks.push(chunk);
      reqBodySize += chunk.length;
    });

    clientReq.on('end', () => {
      const reqBody = Buffer.concat(reqBodyChunks);
      const hostHeader = port !== 443 ? `${hostname}:${port}` : hostname;
      const options: https.RequestOptions = {
        hostname,
        port,
        path: clientReq.url,
        method: clientReq.method,
        headers: {...clientReq.headers, host: hostHeader},
        rejectUnauthorized: false,
      };

      const proxyReq = https.request(options, proxyRes => {
        this.relayResponse(
          requestId,
          startTime,
          clientReq,
          reqBody,
          fullUrl,
          proxyRes,
          clientRes,
        );
      });

      proxyReq.on('error', (err: Error) => {
        logger.warn('[MitmProxy] HTTPS proxy error:', err.message);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Bad Gateway');
        }
      });

      if (reqBody.length > 0) proxyReq.write(reqBody);
      proxyReq.end();
    });
  }

  private relayResponse(
    requestId: string,
    startTime: number,
    clientReq: http.IncomingMessage,
    reqBody: Buffer,
    fullUrl: string,
    proxyRes: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const resBodyChunks: Buffer[] = [];
    let totalResSize = 0;
    let truncated = false;

    proxyRes.on('data', (chunk: Buffer) => {
      if (totalResSize < MAX_BODY_SIZE) resBodyChunks.push(chunk);
      else truncated = true;
      totalResSize += chunk.length;
    });

    proxyRes.on('end', () => {
      const contentType = (proxyRes.headers['content-type'] as string) || null;
      const method = clientReq.method || 'GET';
      const isBinary = contentType
        ? BINARY_CONTENT_TYPES.some(t => contentType.startsWith(t))
        : false;
      const isStreaming = contentType?.includes('text/event-stream') || false;
      const isOptions = method === 'OPTIONS';
      const isStatic = STATIC_EXTENSIONS.test(fullUrl);

      const requestBody =
        reqBody.length > 0 && !isBinary
          ? bodyToUtf8(reqBody, clientReq.headers['content-encoding'])
          : null;
      const responseBody =
        resBodyChunks.length > 0 && !isBinary
          ? bodyToUtf8(
              Buffer.concat(resBodyChunks),
              proxyRes.headers['content-encoding'],
            )
          : null;

      this.onCaptured({
        requestId,
        method,
        url: fullUrl,
        requestHeaders: this.headersToRecord(clientReq.headers),
        requestBody,
        statusCode: proxyRes.statusCode || 0,
        responseHeaders: this.headersToRecord(proxyRes.headers),
        responseBody,
        contentType,
        isOptions,
        isStatic,
        isStreaming,
        isWebSocket: false,
        truncated,
        timestamp: startTime,
      });
    });

    clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(clientRes);
  }

  private headersToRecord(
    headers: http.IncomingHttpHeaders,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      out[key] = headerToString(
        Array.isArray(value) ? value : value.toString(),
      );
    }
    return out;
  }
}
