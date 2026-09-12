/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 移植自 anything-analyzer (MIT License):
 * open-source/anything-analyzer/src/main/proxy/mitm-proxy-server.ts
 * 裁剪：证书下载页、uuid 依赖、EventEmitter。
 * 扩展：注入 MitmInterceptor，承载 block/map_local/map_remote/modify_header/modify_body 改写；支持上游 SOCKS5 代理。
 */
import {randomUUID} from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as url from 'node:url';

import {logger} from '../../utils/logger.js';

import {
  MAX_BODY_SIZE,
  STATIC_EXTENSIONS,
  bodyToUtf8,
  fixHeadersAfterBodyRewrite,
  headerToString,
  isBinaryContentType,
} from './body.js';
import type {CaManager} from './CaManager.js';
import type {ProcessConnectionTracker} from './ProcessConnectionTracker.js';
import {matchesProcessName} from './processMatch.js';
import {applyHeaderChanges} from './rewrite.js';
import type {
  AfterResponseResult,
  BeforeRequestResult,
  CapturedExchange,
  ClientProcessMeta,
  LocalAppsConfig,
  MitmInterceptor,
} from './types.js';
import {
  connectUpstream,
  createUpstreamHttpConnector,
  createUpstreamHttpsConnector,
  formatUpstreamProxy,
  normalizeUpstreamProxy,
  shouldBypassUpstream,
  type UpstreamProxyConfig,
} from './upstream.js';

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
 * 解析 CONNECT 的 authority（RFC 7231 §4.3.6）。
 * IPv6 必须带方括号且用 lastIndexOf(':') 分端口 —— 直接 split(':') 会把
 * `[240c::1]:8080` 切成 hostname=`[240c`（ProxyPin temp_ipv6_test.dart 守护此坑）。
 * hostname 一律剥掉方括号：签证书不需要，且 shouldBypass 的子串匹配需要。
 */
export function parseConnectAuthority(
  url: string,
): {hostname: string; port: number} | null {
  const authority = url.trim();
  if (!authority) return null;

  const DEFAULT_PORT = 443;
  let hostname = authority;
  let port = DEFAULT_PORT;

  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close !== -1) {
      hostname = authority.slice(1, close);
      if (authority[close + 1] === ':') {
        const parsed = parseInt(authority.slice(close + 2), 10);
        if (Number.isFinite(parsed)) port = parsed;
      }
    }
    // 找不到 ']'（畸形如 "[240c"）：整个 authority 当 host，端口取默认。
  } else if (authority.indexOf(':') !== authority.lastIndexOf(':')) {
    // 多个冒号说明是未带方括号的裸 IPv6 地址，无端口，默认 443
    hostname = authority;
    port = DEFAULT_PORT;
  } else {
    const lastColon = authority.lastIndexOf(':');
    if (lastColon !== -1) {
      const parsed = parseInt(authority.slice(lastColon + 1), 10);
      if (Number.isFinite(parsed)) {
        hostname = authority.slice(0, lastColon);
        port = parsed;
      }
    }
  }

  if (!hostname) return null;
  return {hostname, port};
}

interface RequestFlow {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * MitmProxyServer — 嵌入式 HTTP/HTTPS 中间人代理。
 *
 * - 明文 HTTP 直接转发。
 * - HTTPS CONNECT 通过 CaManager 动态签证书拦截并解密。
 * - WS / WSS 流量隧道转发，不解密。
 * - 每个完成的事务通过 onCaptured 回调对外产生 CapturedExchange。
 * - 可选 interceptor 在转发前（beforeRequest）与回传前（afterResponse）改写流量。
 */
export class MitmProxyServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly connections = new Set<net.Socket>();
  private upstreamConfig: UpstreamProxyConfig | null = null;
  private upstreamProxyUrl: string | null = null;

  constructor(
    private readonly caManager: CaManager,
    private readonly onCaptured: (exchange: CapturedExchange) => void,
    private readonly interceptor?: MitmInterceptor,
    private readonly shouldBypass?: (hostname: string) => boolean,
    upstreamProxy?: string | UpstreamProxyConfig,
    private readonly processTracker?: ProcessConnectionTracker,
    private readonly localAppsConfigProvider?: () => LocalAppsConfig,
  ) {
    if (upstreamProxy) {
      this.setUpstreamProxy(upstreamProxy);
    }
  }

  private readonly socketProcessMap = new WeakMap<
    net.Socket,
    {clientProcess?: ClientProcessMeta; bypass: boolean}
  >();

  async start(port: number): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });
    this.server.on('connect', (req, clientSocket, head) => {
      void this.handleConnect(req, clientSocket as net.Socket, head);
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

  setUpstreamProxy(upstreamProxy?: string | UpstreamProxyConfig | null): void {
    if (!upstreamProxy) {
      this.upstreamConfig = null;
      this.upstreamProxyUrl = null;
      return;
    }
    this.upstreamConfig = normalizeUpstreamProxy(upstreamProxy);
    this.upstreamProxyUrl =
      typeof upstreamProxy === 'string'
        ? upstreamProxy
        : formatUpstreamProxy(this.upstreamConfig);
  }

  getUpstreamProxy(): string | null {
    return this.upstreamProxyUrl;
  }

  getUpstreamConfig(): UpstreamProxyConfig | null {
    return this.upstreamConfig;
  }

  /**
   * 进程分流判定（对标 mitmproxy Local Applications 机制）。
   * bypass=true 时调用方走 relayDirectConnect；clientProcess 供 capture 注入。
   */
  private async resolveClientProcess(
    remotePort: number | undefined,
    socket?: net.Socket,
  ): Promise<{
    clientProcess?: ClientProcessMeta;
    bypass: boolean;
  }> {
    if (socket && this.socketProcessMap.has(socket)) {
      return this.socketProcessMap.get(socket)!;
    }

    const config = this.localAppsConfigProvider?.();
    if (!config?.enabled) {
      const res = {bypass: false};
      if (socket) this.socketProcessMap.set(socket, res);
      return res;
    }

    let clientProcess: ClientProcessMeta | undefined = undefined;
    if (remotePort) {
      const syncMeta = this.processTracker?.getProcessByPortSync(remotePort);
      if (syncMeta) {
        clientProcess = syncMeta;
      } else if (this.processTracker) {
        if (typeof this.processTracker.getProcessByPort === 'function') {
          clientProcess =
            (await this.processTracker.getProcessByPort(remotePort)) ??
            undefined;
        }
      }
    }

    if (config.targets.length > 0) {
      const isTarget =
        clientProcess != null &&
        config.targets.some(t => matchesProcessName(t, clientProcess.name));
      const res = isTarget
        ? {clientProcess, bypass: false}
        : {clientProcess, bypass: true};
      if (socket) this.socketProcessMap.set(socket, res);
      return res;
    }

    const res = {clientProcess, bypass: false};
    if (socket) this.socketProcessMap.set(socket, res);
    return res;
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
    const localAppsPromise = this.resolveClientProcess(
      clientReq.socket.remotePort,
      clientReq.socket,
    );
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const parsed = url.parse(targetUrl);
    const reqBodyChunks: Buffer[] = [];
    let reqBodySize = 0;

    clientReq.on('data', (chunk: Buffer) => {
      if (reqBodySize < MAX_BODY_SIZE) reqBodyChunks.push(chunk);
      reqBodySize += chunk.length;
    });

    clientReq.on('end', async () => {
      try {
        const localApps = await localAppsPromise;
        const shouldRecord =
          !localApps.bypass &&
          this.shouldBypass?.(parsed.hostname ?? '') !== true;
        const flow: RequestFlow = {
          method: clientReq.method || 'GET',
          url: targetUrl,
          headers: this.headersToRecord(clientReq.headers),
          body: Buffer.concat(reqBodyChunks),
        };
        delete flow.headers['proxy-connection'];

        const before = this.interceptor?.beforeRequest?.(flow);
        if (
          before &&
          this.handleBeforeRequest(
            before,
            requestId,
            startTime,
            flow,
            clientRes,
            shouldRecord,
            localApps.clientProcess,
          )
        ) {
          return;
        }
        if (before && before.action === 'forward') {
          this.applyRequestModification(before, parsed, flow);
        }

        const options: http.RequestOptions = {
          hostname: parsed.hostname ?? 'localhost',
          port: parseInt(parsed.port ?? '80', 10),
          path: parsed.path ?? '/',
          method: flow.method,
          headers: flow.headers,
        };

        const targetHost = parsed.hostname ?? 'localhost';
        const useUpstream =
          this.upstreamConfig !== null &&
          !shouldBypassUpstream(targetHost, this.upstreamConfig.bypassHosts);

        if (useUpstream && this.upstreamConfig) {
          options.createConnection = createUpstreamHttpConnector(
            this.upstreamConfig,
            80,
          );
        }

        const proxyReq = http.request(options, proxyRes => {
          this.relayResponse(
            requestId,
            startTime,
            flow,
            before && before.action === 'forward'
              ? before.appliedRuleIds
              : undefined,
            proxyRes,
            clientRes,
            shouldRecord,
            localApps.clientProcess,
          );
        });

        proxyReq.on('error', (err: Error) => {
          logger.warn('[MitmProxy] HTTP proxy error:', err.message);
          if (!clientRes.headersSent) {
            clientRes.writeHead(502);
            clientRes.end('Bad Gateway');
          }
        });

        if (flow.body.length > 0) proxyReq.write(flow.body);
        proxyReq.end();
      } catch (err) {
        logger.warn('[MitmProxy] handleHttpRequest error:', err);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Bad Gateway');
        }
      }
    });
  }

  // ── 明文 ws:// upgrade ──

  private handleWsUpgrade(
    clientReq: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
    isTls: boolean,
    targetHostname?: string,
    targetPort?: number,
    clientProcess?: ClientProcessMeta,
  ): void {
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const targetUrl = clientReq.url || '/';
    const parsed = url.parse(targetUrl);

    let hostname = targetHostname;
    let port = targetPort;

    if (!hostname) {
      if (parsed.hostname) {
        hostname = parsed.hostname;
        port = parsed.port ? parseInt(parsed.port, 10) : (isTls ? 443 : 80);
      } else if (clientReq.headers.host) {
        const hostAuth = parseConnectAuthority(clientReq.headers.host);
        if (hostAuth) {
          hostname = hostAuth.hostname;
          const hasExplicitPort =
            clientReq.headers.host.includes(':') &&
            !(
              clientReq.headers.host.startsWith('[') &&
              clientReq.headers.host.endsWith(']')
            );
          port = hasExplicitPort ? hostAuth.port : (isTls ? 443 : 80);
        }
      }
    }

    hostname = hostname || 'localhost';
    port = port || (isTls ? 443 : 80);

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

        if (this.shouldBypass?.(hostname) !== true) {
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
            modified: false,
            clientProcess,
          });
        }
      };
      serverSocket.on('data', onData);
    };

    const onConnected = (serverSocket: net.Socket): void => {
      serverSocket.on('error', (err: Error) => {
        logger.warn(
          `[MitmProxy] WS connect error for ${hostname}:`,
          err.message,
        );
        clientSocket.destroy();
      });
      connectAndTunnel(serverSocket);
    };

    const useUpstream =
      this.upstreamConfig !== null &&
      !shouldBypassUpstream(hostname, this.upstreamConfig.bypassHosts);

    if (useUpstream && this.upstreamConfig) {
      connectUpstream(this.upstreamConfig, {host: hostname, port})
        .then(rawSocket => {
          if (isTls) {
            const servername = net.isIP(hostname) ? undefined : hostname;
            const tlsSocket = tls.connect(
              {
                socket: rawSocket,
                servername,
                rejectUnauthorized: false,
              },
              () => onConnected(tlsSocket),
            );
            tlsSocket.on('error', (err: Error) => {
              logger.warn(
                `[MitmProxy] WSS TLS connect error for ${hostname}:`,
                err.message,
              );
              clientSocket.destroy();
            });
          } else {
            onConnected(rawSocket);
          }
        })
        .catch(err => {
          logger.warn(
            `[MitmProxy] WS upstream connect error for ${hostname}:`,
            err.message,
          );
          clientSocket.destroy();
        });
    } else if (isTls) {
      const servername = net.isIP(hostname) ? undefined : hostname;
      const tlsSocket = tls.connect(
        {
          port,
          host: hostname,
          servername,
          rejectUnauthorized: false,
        },
        () => onConnected(tlsSocket),
      );
      tlsSocket.on('error', (err: Error) => {
        logger.warn(
          `[MitmProxy] WSS connect error for ${hostname}:`,
          err.message,
        );
        clientSocket.destroy();
      });
    } else {
      const serverSocket = net.connect(port, hostname, () =>
        onConnected(serverSocket),
      );
      serverSocket.on('error', (err: Error) => {
        logger.warn(
          `[MitmProxy] WS connect error for ${hostname}:`,
          err.message,
        );
        clientSocket.destroy();
      });
    }
  }

  // ── HTTPS CONNECT 拦截 ──

  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): Promise<void> {
    try {
      const authority = parseConnectAuthority(req.url || '');
      if (!authority) {
        clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const {hostname, port} = authority;

      const localApps = await this.resolveClientProcess(
        clientSocket.remotePort,
        clientSocket,
      );
      if (localApps.bypass) {
        this.relayDirectConnect(hostname, port, clientSocket, head);
        return;
      }

      // 旁路（spec §3.1）：不解密不签证书，纯传输层双向 pipe。
      if (this.shouldBypass?.(hostname) === true) {
        this.relayDirectConnect(hostname, port, clientSocket, head);
        return;
      }

      // 80 端口为明文 HTTP 隧道（如 Android tun2socks/Postern 转发的明文流量），走传输层盲转发，不包装 TLS
      if (port === 80) {
        this.relayDirectConnect(hostname, port, clientSocket, head);
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
        this.handleDecryptedRequest(
          hostname,
          port,
          decryptedReq,
          decryptedRes,
          localApps.clientProcess,
        );
      });
      miniServer.on('upgrade', (upgradeReq, upgradeSocket, upgradeHead) => {
        this.handleWsUpgrade(
          upgradeReq,
          upgradeSocket as net.Socket,
          upgradeHead,
          true,
          hostname,
          port,
          localApps.clientProcess,
        );
      });
      // SAFETY: TLSSocket extends net.Socket and fulfills the net.Socket interface for miniServer connection handling.
      miniServer.emit('connection', tlsSocket as unknown as net.Socket);

      tlsSocket.on('error', (err: Error) => {
        logger.warn(`[MitmProxy] TLS error for ${hostname}:`, err.message);
        clientSocket.destroy();
      });
      clientSocket.on('error', () => tlsSocket.destroy());
    } catch (err) {
      logger.warn('[MitmProxy] handleConnect error:', err);
      clientSocket.destroy();
    }
  }

  /** 纯传输层盲转发（原 hostname-bypass 分支提取，spec §3.3）。含上游 SOCKS5 分支。 */
  private relayDirectConnect(
    hostname: string,
    port: number,
    clientSocket: net.Socket,
    head: Buffer,
  ): void {
    const useUpstream =
      this.upstreamConfig !== null &&
      !shouldBypassUpstream(hostname, this.upstreamConfig.bypassHosts);

    if (useUpstream && this.upstreamConfig) {
      connectUpstream(this.upstreamConfig, {host: hostname, port})
        .then(tunnel => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length > 0) tunnel.write(head);
          tunnel.pipe(clientSocket);
          clientSocket.pipe(tunnel);
          tunnel.on('error', () => clientSocket.destroy());
          clientSocket.on('error', () => tunnel.destroy());
          tunnel.on('close', () => clientSocket.destroy());
          clientSocket.on('close', () => tunnel.destroy());
        })
        .catch(err => {
          logger.warn(
            `[MitmProxy] Bypass upstream connect error for ${hostname}:`,
            err.message,
          );
          clientSocket.destroy();
        });
      return;
    }

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const tunnel = net.connect(port, hostname, () => {
      if (head.length > 0) tunnel.write(head);
      tunnel.pipe(clientSocket);
      clientSocket.pipe(tunnel);
    });
    // 上游失败仅毁 socket，不写 capture、不打日志刷屏（spec §4）。
    tunnel.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => tunnel.destroy());
    tunnel.on('close', () => clientSocket.destroy());
    clientSocket.on('close', () => tunnel.destroy());
  }

  private handleDecryptedRequest(
    hostname: string,
    port: number,
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
    clientProcess?: ClientProcessMeta,
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
      const flow: RequestFlow = {
        method: clientReq.method || 'GET',
        url: fullUrl,
        headers: this.headersToRecord(clientReq.headers),
        body: Buffer.concat(reqBodyChunks),
      };
      flow.headers.host = port !== 443 ? `${hostname}:${port}` : hostname;

      const before = this.interceptor?.beforeRequest?.(flow);
      if (
        before &&
        this.handleBeforeRequest(
          before,
          requestId,
          startTime,
          flow,
          clientRes,
          true,
          clientProcess,
        )
      ) {
        return;
      }

      const parsed = url.parse(flow.url);
      if (before && before.action === 'forward') {
        this.applyRequestModification(before, parsed, flow);
      }

      const targetHost = parsed.hostname ?? hostname;
      const targetPort = parseInt(parsed.port ?? String(port), 10);
      const options: https.RequestOptions = {
        hostname: targetHost,
        port: targetPort,
        path: parsed.path ?? '/',
        method: flow.method,
        headers: flow.headers,
        rejectUnauthorized: false,
      };

      const useUpstream =
        this.upstreamConfig !== null &&
        !shouldBypassUpstream(targetHost, this.upstreamConfig.bypassHosts);

      if (useUpstream && this.upstreamConfig) {
        options.createConnection = createUpstreamHttpsConnector(
          this.upstreamConfig,
          targetHost,
          targetPort,
        );
      }

      const proxyReq = https.request(options, proxyRes => {
        this.relayResponse(
          requestId,
          startTime,
          flow,
          before && before.action === 'forward'
            ? before.appliedRuleIds
            : undefined,
          proxyRes,
          clientRes,
          true,
          clientProcess,
        );
      });

      proxyReq.on('error', (err: Error) => {
        logger.warn('[MitmProxy] HTTPS proxy error:', err.message);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Bad Gateway');
        }
      });

      if (flow.body.length > 0) proxyReq.write(flow.body);
      proxyReq.end();
    });
  }

  /**
   * 处理 beforeRequest 的 terminal 结果（block / respond）。命中返回 true（已处理，无需转发）。
   * forward 返回 false，由调用方走 apply-request-modification。
   */
  private handleBeforeRequest(
    before: BeforeRequestResult,
    requestId: string,
    startTime: number,
    flow: RequestFlow,
    clientRes: http.ServerResponse,
    shouldRecord = true,
    clientProcess?: ClientProcessMeta,
  ): boolean {
    if (before.action === 'forward') return false;

    if (!shouldRecord) {
      if (before.action === 'block') {
        const closeConnection =
          before.closeConnection ?? before.statusCode === 444;
        if (closeConnection) {
          clientRes.destroy();
        } else {
          clientRes.writeHead(before.statusCode, {connection: 'close'});
          clientRes.end(before.body ?? '');
        }
        return true;
      }
      const headers = before.headers ?? {};
      clientRes.writeHead(before.statusCode, headers);
      clientRes.end(before.body);
      return true;
    }

    const base = {
      requestId,
      method: flow.method,
      url: flow.url,
      requestHeaders: flow.headers,
      requestBody: flow.body.length > 0 ? flow.body.toString('utf-8') : null,
      contentType: null as string | null,
      isOptions: flow.method === 'OPTIONS',
      isStatic: false,
      isStreaming: false,
      isWebSocket: false,
      truncated: false,
      timestamp: startTime,
      modified: true,
      appliedRuleIds: before.appliedRuleIds,
      ...(clientProcess && {clientProcess}),
    };

    if (before.action === 'block') {
      const closeConnection =
        before.closeConnection ?? before.statusCode === 444;
      if (closeConnection) {
        clientRes.destroy();
        this.onCaptured({
          ...base,
          statusCode: before.statusCode,
          responseHeaders: {},
          responseBody: before.body ?? null,
        });
        return true;
      }
      clientRes.writeHead(before.statusCode, {connection: 'close'});
      clientRes.end(before.body ?? '');
      this.onCaptured({
        ...base,
        statusCode: before.statusCode,
        responseHeaders: {connection: 'close'},
        responseBody: before.body ?? null,
      });
      return true;
    }

    // respond（map_local）
    const headers = before.headers ?? {};
    clientRes.writeHead(before.statusCode, headers);
    clientRes.end(before.body);
    this.onCaptured({
      ...base,
      statusCode: before.statusCode,
      responseHeaders: headers,
      responseBody: before.body.toString('utf-8'),
      contentType: (headers['content-type'] as string | undefined) ?? null,
    });
    return true;
  }

  /** 把 forward 的 modification 应用到 flow 与 parsed（原地更新，parsed 用于转发目标）。 */
  private applyRequestModification(
    before: Extract<BeforeRequestResult, {action: 'forward'}>,
    parsed: url.UrlWithStringQuery,
    flow: RequestFlow,
  ): void {
    const modification = before.modification;
    if (!modification) return;
    if (modification.method) flow.method = modification.method.toUpperCase();
    if (modification.url) {
      const rewritten = url.parse(modification.url);
      parsed.hostname = rewritten.hostname ?? parsed.hostname;
      parsed.port = rewritten.port ?? parsed.port;
      parsed.path = rewritten.path ?? parsed.path;
      flow.headers.host =
        (rewritten.hostname ?? parsed.hostname) || 'localhost';
    }
    if (modification.setHeaders || modification.removeHeaders) {
      flow.headers = applyHeaderChanges(flow.headers, {
        set: modification.setHeaders,
        remove: modification.removeHeaders,
      });
    }
    if (modification.body !== undefined) {
      flow.body = modification.body;
      flow.headers = fixHeadersAfterBodyRewrite(
        flow.headers,
        flow.body.length,
        {
          stripContentEncoding: false,
        },
      );
    }
  }

  private relayResponse(
    requestId: string,
    startTime: number,
    flow: RequestFlow,
    appliedRuleIds: string[] | undefined,
    proxyRes: http.IncomingMessage,
    clientRes: http.ServerResponse,
    shouldRecord = true,
    clientProcess?: ClientProcessMeta,
  ): void {
    const contentType = (proxyRes.headers['content-type'] as string) || null;
    const method = flow.method;
    const isBinary = contentType ? isBinaryContentType(contentType) : false;
    const isStreaming = contentType?.includes('text/event-stream') || false;
    const isOptions = method === 'OPTIONS';
    const isStatic = STATIC_EXTENSIONS.test(flow.url);
    const statusCode = proxyRes.statusCode || 0;

    const resBodyChunks: Buffer[] = [];
    let totalResSize = 0;
    let truncated = false;
    let escapedEmit: (() => void) | null = null;
    let escapeCommitted = false;

    // 判定期预判：响应头已声明 content-length 且超限 → 直接 live-pipe，连那 1MB 都不 buffer。
    const declaredLength = Number(proxyRes.headers['content-length']);
    const oversizedByHeader =
      Number.isFinite(declaredLength) && declaredLength > MAX_BODY_SIZE;
    const bufferBody =
      !isBinary &&
      !oversizedByHeader &&
      this.interceptor?.hasResponseBodyRules() === true;

    /**
     * 越限叛逃到 live-pipe（spec §2.2）：已 buffer 的是压缩后原始字节，
     * 不能只发一半 —— 把完整已 buffer 字节写给客户端后交给 pipe 接管。
     * 语义与 live-pipe 完全同构：afterResponse 传 body:null，header 改写照常生效，
     * body 改写由 rewrite.ts:356 的 body===null → continue 天然跳过。
     */
    const escapeToPipe = (currentChunk?: Buffer): void => {
      if (escapeCommitted) return;
      escapeCommitted = true;
      truncated = true;

      logger.warn(
        `[MitmProxy] response body 超过 ${MAX_BODY_SIZE} 字节，跳过 response body 改写规则：${flow.url}`,
      );

      const after = this.interceptor?.afterResponse?.({
        requestId,
        method,
        url: flow.url,
        requestHeaders: flow.headers,
        requestBody: flow.body.length > 0 ? flow.body : null,
        statusCode,
        headers: this.headersToRecord(proxyRes.headers),
        body: null,
        truncated: true,
      }) as AfterResponseResult | undefined;

      let outHeaders = this.headersToRecord(proxyRes.headers);
      const mod = after?.modification;
      if (mod?.setHeaders || mod?.removeHeaders) {
        outHeaders = applyHeaderChanges(outHeaders, {
          set: mod.setHeaders,
          remove: mod.removeHeaders,
        });
      }

      clientRes.writeHead(statusCode, outHeaders);
      // 只写字节，不清空 resBodyChunks —— 它还要留给 emit 解码成 capture 文本。
      for (const chunk of resBodyChunks) clientRes.write(chunk);
      if (currentChunk) clientRes.write(currentChunk);
      proxyRes.pipe(clientRes);

      escapedEmit = () =>
        emit(
          outHeaders,
          null,
          after !== undefined || (appliedRuleIds?.length ?? 0) > 0,
          [...(appliedRuleIds ?? []), ...(after?.appliedRuleIds ?? [])],
          Buffer.concat(resBodyChunks),
        );
    };

    const onBodyData = (chunk: Buffer): void => {
      if (totalResSize < MAX_BODY_SIZE) {
        resBodyChunks.push(chunk);
      } else if (bufferBody && !escapeCommitted) {
        escapeToPipe(chunk);
      } else {
        truncated = true;
      }
      totalResSize += chunk.length;
    };

    const emit = (
      responseHeaders: Record<string, string>,
      responseBody: string | null,
      modified: boolean,
      ruleIds: string[],
      buffered: Buffer | null,
    ): void => {
      if (!shouldRecord) return;
      const requestBody =
        flow.body.length > 0 && !isBinary
          ? bodyToUtf8(flow.body, flow.headers['content-encoding'])
          : null;
      this.onCaptured({
        requestId,
        method,
        url: flow.url,
        requestHeaders: flow.headers,
        requestBody,
        statusCode,
        responseHeaders,
        responseBody:
          responseBody ??
          (buffered && !isBinary
            ? bodyToUtf8(buffered, proxyRes.headers['content-encoding'])
            : null),
        contentType,
        isOptions,
        isStatic,
        isStreaming,
        isWebSocket: false,
        truncated,
        timestamp: startTime,
        modified,
        ...(ruleIds.length > 0 && {appliedRuleIds: ruleIds}),
        responseBodySize: totalResSize,
        responseBodyBase64:
          isBinary && buffered && !truncated
            ? buffered.toString('base64')
            : null,
        ...(clientProcess && {clientProcess}),
      });
    };

    if (bufferBody) {
      proxyRes.on('data', onBodyData);
      proxyRes.on('end', () => {
        // 叛逃后 socket 的结束归 pipe 管：这里只能 emit，再 writeHead/end 会抛错或截断流。
        if (escapeCommitted) {
          escapedEmit?.();
          return;
        }
        const buffered =
          !truncated && resBodyChunks.length > 0
            ? Buffer.concat(resBodyChunks)
            : null;
        const after = this.interceptor?.afterResponse?.({
          requestId,
          method,
          url: flow.url,
          requestHeaders: flow.headers,
          requestBody: flow.body.length > 0 ? flow.body : null,
          statusCode,
          headers: this.headersToRecord(proxyRes.headers),
          body: buffered,
          truncated,
        }) as AfterResponseResult | undefined;

        let outHeaders = this.headersToRecord(proxyRes.headers);
        const mod = after?.modification;
        if (mod?.setHeaders || mod?.removeHeaders) {
          outHeaders = applyHeaderChanges(outHeaders, {
            set: mod.setHeaders,
            remove: mod.removeHeaders,
          });
        }
        const outBody: Buffer | null =
          mod?.body !== undefined ? mod.body : buffered;
        if (mod?.body !== undefined) {
          outHeaders = fixHeadersAfterBodyRewrite(outHeaders, outBody!.length, {
            stripContentEncoding: true,
          });
        }

        const modified =
          after !== undefined || (appliedRuleIds?.length ?? 0) > 0;
        const ruleIds = [
          ...(appliedRuleIds ?? []),
          ...(after?.appliedRuleIds ?? []),
        ];

        clientRes.writeHead(statusCode, outHeaders);
        if (outBody !== null) {
          clientRes.end(outBody);
        } else {
          // 截断且无 body 修改：只能回传已缓冲前缀（buffer 模式下截断即丢尾部）。
          clientRes.end();
        }
        emit(
          outHeaders,
          mod?.body !== undefined ? bodyToUtf8(mod.body, undefined) : null,
          modified,
          ruleIds,
          buffered,
        );
      });
      return;
    }

    // live-pipe：header-only 改写，body 边转发边 buffer 供 capture。
    const after = this.interceptor?.afterResponse?.({
      requestId,
      method,
      url: flow.url,
      requestHeaders: flow.headers,
      requestBody: flow.body.length > 0 ? flow.body : null,
      statusCode,
      headers: this.headersToRecord(proxyRes.headers),
      body: null,
      truncated: false,
    }) as AfterResponseResult | undefined;

    let outHeaders = this.headersToRecord(proxyRes.headers);
    const mod = after?.modification;
    if (mod?.setHeaders || mod?.removeHeaders) {
      outHeaders = applyHeaderChanges(outHeaders, {
        set: mod.setHeaders,
        remove: mod.removeHeaders,
      });
    }
    const modified = after !== undefined || (appliedRuleIds?.length ?? 0) > 0;
    const ruleIds = [
      ...(appliedRuleIds ?? []),
      ...(after?.appliedRuleIds ?? []),
    ];

    clientRes.writeHead(statusCode, outHeaders);
    proxyRes.on('data', onBodyData);
    proxyRes.on('end', () => {
      const buffered =
        resBodyChunks.length > 0 ? Buffer.concat(resBodyChunks) : null;
      emit(outHeaders, null, modified, ruleIds, buffered);
    });
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
