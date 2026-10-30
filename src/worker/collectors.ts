/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CDPSession,
  ConsoleMessage,
  Page,
  Request,
  WebSocket as PlaywrightWebSocket,
} from 'patchright';

import {PageCollector} from '../modules/collector/PageCollector.js';
import type {
  RequestInitiator,
  WebSocketData,
} from '../modules/network/NetworkTypes.js';
import type {ConsoleMessageEntry} from '../tools/console/types.js';

// ─── 辅助函数 ────────────────────────────────────────

function safeDetach<T extends Page, K>(
  page: T,
  handlers: WeakMap<T, K>,
  detach: (handler: K) => void,
): void {
  const handler = handlers.get(page);
  if (handler) {
    try {
      detach(handler);
    } catch {
      // Page closed
    }
    handlers.delete(page);
  }
}

// ─── 数据类型 ────────────────────────────────────────

export interface TrackedRequest {
  stableId: number;
  request: Request;
  initiator?: RequestInitiator;
}

export interface TrackedConsoleMessage {
  stableId: number;
  message: ConsoleMessage | Error;
}

export type TrackedWebSocketData = WebSocketData & {stableId: number};

// ─── NetworkRequestCollector ──────────────────────────

/**
 * 网络请求收集器
 * 覆盖 splitOnNavigation：保留最后一个导航请求到新段
 */
export class NetworkRequestCollector extends PageCollector<TrackedRequest> {
  private readonly _onRequestHandlers = new WeakMap<
    Page,
    (req: Request) => void
  >();
  private readonly _cdpSessions = new WeakMap<Page, CDPSession>();
  private readonly _cdpRequestListeners = new WeakMap<
    Page,
    (event: any) => void
  >();
  private readonly _initiatorQueues = new WeakMap<
    Page,
    Map<string, RequestInitiator[]>
  >();

  private _getUrlPath(urlStr: string): string {
    try {
      const url = new URL(urlStr);
      return url.pathname;
    } catch {
      return urlStr;
    }
  }

  protected override splitOnNavigation(page: Page): void {
    const navigations = this.storage.get(page);
    if (!navigations) return;

    const requests = navigations[0]!;
    const lastNavIdx = requests.findLastIndex(tracked => {
      const req = tracked.request;
      return (
        req.frame() === page.mainFrame() && req.resourceType() === 'document'
      );
    });

    if (lastNavIdx !== -1) {
      const fromCurrentNavigation = requests.splice(lastNavIdx);
      navigations.unshift(fromCurrentNavigation);
    } else {
      navigations.unshift([]);
    }
    navigations.splice(this.maxNavigationSaved);
  }

  protected attachListeners(page: Page, navigations: TrackedRequest[][]): void {
    const idGenerator = this.idGenerators.get(page)!;
    const initiatorQueueMap = new Map<string, RequestInitiator[]>();
    this._initiatorQueues.set(page, initiatorQueueMap);

    const onRequest = (req: Request): void => {
      const key = `${req.method()}:${this._getUrlPath(req.url())}`;
      const queue = initiatorQueueMap.get(key);
      const initiator = queue && queue.length > 0 ? queue.shift() : undefined;

      const tracked: TrackedRequest = {
        stableId: idGenerator(),
        request: req,
        initiator,
      };
      (req as any).initiator = () => tracked.initiator;

      navigations[0]!.push(tracked);
    };

    page.on('request', onRequest);
    this._onRequestHandlers.set(page, onRequest);

    page
      .context()
      .newCDPSession(page)
      .then(client => {
        this._cdpSessions.set(page, client);
        const MAX_QUEUE_PER_KEY = 50;
        const onCdpRequest = (event: any): void => {
          if (event.request && event.initiator) {
            const key = `${event.request.method}:${this._getUrlPath(
              event.request.url,
            )}`;
            let queue = initiatorQueueMap.get(key);
            if (!queue) {
              queue = [];
              initiatorQueueMap.set(key, queue);
            }
            queue.push(event.initiator as RequestInitiator);
            // 防止无匹配请求消费时队列无界增长：
            // 队列满时丢弃最旧的 initiator，极端情况下后续匹配可能取到较新的 initiator（错配）。
            if (queue.length > MAX_QUEUE_PER_KEY) {
              queue.shift();
            }
          }
        };
        client.on('Network.requestWillBeSent', onCdpRequest);
        this._cdpRequestListeners.set(page, onCdpRequest);
        client.send('Network.enable').catch(() => {
          /* ignore */
        });
      })
      .catch(() => {
        /* ignore */
      });
  }

  protected detachListeners(page: Page): void {
    safeDetach(page, this._onRequestHandlers, handler =>
      page.off('request', handler),
    );
    const client = this._cdpSessions.get(page);
    if (client) {
      const listener = this._cdpRequestListeners.get(page);
      if (listener) {
        try {
          client.off('Network.requestWillBeSent', listener);
        } catch {
          /* ignore */
        }
        this._cdpRequestListeners.delete(page);
      }
      try {
        client.detach().catch(() => {
          /* ignore */
        });
      } catch {
        /* ignore */
      }
      this._cdpSessions.delete(page);
    }
    this._initiatorQueues.delete(page);
  }
}

// ─── ConsoleMessageCollector ──────────────────────────

export class ConsoleMessageCollector extends PageCollector<TrackedConsoleMessage> {
  private readonly _onConsoleHandlers = new WeakMap<
    Page,
    (msg: ConsoleMessage) => void
  >();
  private readonly _onPageErrorHandlers = new WeakMap<
    Page,
    (err: Error) => void
  >();
  private readonly _cdpSessions = new WeakMap<Page, CDPSession>();
  private readonly _enabledPages = new WeakSet<Page>();

  /**
   * 按需激活当前页面的 CDP Console 收集。
   *
   * 遵循 AGENTS.md 协议层反检测分层：启动时不全局 eager-enable Runtime 域，
   * 仅在工具层显式查询（list_console_messages / get_console_message）时懒激活。
   * CDP 会在 Runtime.enable 时自动向该会话补发此前在页面中缓冲的全部 consoleAPICalled 事件。
   */
  async ensureCdpSession(page: Page): Promise<void> {
    if (this._enabledPages.has(page) || page.isClosed()) return;
    this._enabledPages.add(page);

    const navigations = this.storage.get(page);
    if (!navigations) return;
    const idGenerator = this.idGenerators.get(page) ?? (() => Date.now());

    try {
      const client = await page.context().newCDPSession(page);
      this._cdpSessions.set(page, client);

      client.on('Runtime.consoleAPICalled', (event: any) => {
        const text = (event.args ?? [])
          .map((a: any) =>
            a.value !== undefined ? String(a.value) : (a.description ?? ''),
          )
          .join(' ');
        const entry: ConsoleMessageEntry = {
          type: () => event.type,
          text: () => text,
          args: () =>
            (event.args ?? []).map((a: any) => ({
              remoteObject: () => ({
                objectId: a.objectId,
                value: a.value,
                description: a.description,
              }),
            })),
        };
        const currentNav = this.storage.get(page);
        if (currentNav && currentNav[0]) {
          currentNav[0].push({
            stableId: idGenerator(),
            message: entry as unknown as ConsoleMessage,
          });
        }
      });

      client.on('Runtime.exceptionThrown', (event: any) => {
        const desc =
          event.exceptionDetails?.exception?.description ||
          event.exceptionDetails?.text ||
          'Uncaught error';
        const currentNav = this.storage.get(page);
        if (currentNav && currentNav[0]) {
          currentNav[0].push({
            stableId: idGenerator(),
            message: new Error(desc) as unknown as ConsoleMessage,
          });
        }
      });

      await client.send('Runtime.enable');
      // 给事件循环排空 CDP 同步重放的历史消息
      await new Promise(r => setTimeout(r, 60));
    } catch {
      // 忽略 CDP 初始化异常
    }
  }

  protected attachListeners(
    page: Page,
    navigations: TrackedConsoleMessage[][],
  ): void {
    const idGenerator = this.idGenerators.get(page)!;
    const onConsole = (msg: ConsoleMessage): void => {
      navigations[0]!.push({stableId: idGenerator(), message: msg});
    };
    const onPageError = (err: Error): void => {
      navigations[0]!.push({stableId: idGenerator(), message: err});
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    this._onConsoleHandlers.set(page, onConsole);
    this._onPageErrorHandlers.set(page, onPageError);
  }

  protected detachListeners(page: Page): void {
    safeDetach(page, this._onConsoleHandlers, handler =>
      page.off('console', handler),
    );
    safeDetach(page, this._onPageErrorHandlers, handler =>
      page.off('pageerror', handler),
    );
    const client = this._cdpSessions.get(page);
    if (client) {
      this._cdpSessions.delete(page);
      client.detach().catch(() => undefined);
    }
    this._enabledPages.delete(page);
  }
}

// ─── WebSocketCollector ──────────────────────────────

export class WsCollector extends PageCollector<TrackedWebSocketData> {
  private connectionMaps = new WeakMap<
    Page,
    Map<string, TrackedWebSocketData>
  >();
  private requestIdCounters = new WeakMap<Page, number>();
  private readonly _onWebSocketHandlers = new WeakMap<
    Page,
    (ws: PlaywrightWebSocket) => void
  >();
  private readonly _cdpSessions = new WeakMap<Page, CDPSession>();

  protected override splitOnNavigation(page: Page): void {
    super.splitOnNavigation(page);
    this.connectionMaps.set(page, new Map());
    this.requestIdCounters.set(page, 0);
  }

  protected attachListeners(
    page: Page,
    navigations: TrackedWebSocketData[][],
  ): void {
    const idGenerator = this.idGenerators.get(page)!;
    this.connectionMaps.set(page, new Map());
    this.requestIdCounters.set(page, 0);

    const onWebSocket = (ws: PlaywrightWebSocket): void => {
      const connectionMap = this.connectionMaps.get(page);
      if (!connectionMap) return;

      let counter = this.requestIdCounters.get(page) ?? 0;
      counter++;
      this.requestIdCounters.set(page, counter);
      const requestId = `ws-${counter}-${Date.now()}`;

      const tracked: TrackedWebSocketData = {
        connection: {
          requestId,
          url: ws.url(),
          status: 'open',
          createdAt: Date.now(),
        },
        frames: [],
        stableId: idGenerator(),
      };

      connectionMap.set(requestId, tracked);
      navigations[0]!.push(tracked);

      ws.on('framereceived', data => {
        const payload =
          typeof data.payload === 'string'
            ? data.payload
            : data.payload.toString('base64');
        const opcode = typeof data.payload === 'string' ? 1 : 2;
        tracked.frames.push({
          requestId,
          direction: 'received',
          timestamp: Date.now(),
          opcode,
          payloadData: payload,
        });
      });

      ws.on('framesent', data => {
        const payload =
          typeof data.payload === 'string'
            ? data.payload
            : data.payload.toString('base64');
        const opcode = typeof data.payload === 'string' ? 1 : 2;
        tracked.frames.push({
          requestId,
          direction: 'sent',
          timestamp: Date.now(),
          opcode,
          payloadData: payload,
        });
      });

      ws.on('close', () => {
        tracked.connection.status = 'closed';
        tracked.connection.closedAt = Date.now();
      });
    };

    page.on('websocket', onWebSocket);
    this._onWebSocketHandlers.set(page, onWebSocket);

    // 在 CDP 协议层监听 Network.webSocket*（用于 Patchright 未派发 websocket 事件时的备用通道）
    page
      .context()
      .newCDPSession(page)
      .then(async client => {
        this._cdpSessions.set(page, client);

        const onWsCreated = (event: any): void => {
          const connectionMap = this.connectionMaps.get(page);
          if (!connectionMap) return;
          const reqId = String(event.requestId);
          if (connectionMap.has(reqId)) return;

          let counter = this.requestIdCounters.get(page) ?? 0;
          counter++;
          this.requestIdCounters.set(page, counter);

          const tracked: TrackedWebSocketData = {
            connection: {
              requestId: reqId,
              url: event.url ?? '',
              status: 'open',
              createdAt: Date.now(),
            },
            frames: [],
            stableId: idGenerator(),
          };

          connectionMap.set(reqId, tracked);
          const currentNav = this.storage.get(page);
          if (currentNav && currentNav[0]) {
            currentNav[0].push(tracked);
          }
        };

        const onWsFrame = (
          event: any,
          direction: 'sent' | 'received',
        ): void => {
          const connectionMap = this.connectionMaps.get(page);
          if (!connectionMap) return;
          const reqId = String(event.requestId);
          const tracked = connectionMap.get(reqId);
          if (!tracked) return;

          const response = event.response ?? {};
          const payload =
            typeof response.payloadData === 'string'
              ? response.payloadData
              : String(response.payloadData ?? '');
          const opcode =
            typeof response.opcode === 'number' ? response.opcode : 1;

          tracked.frames.push({
            requestId: reqId,
            direction,
            timestamp: Date.now(),
            opcode,
            payloadData: payload,
          });
        };

        const onWsClosed = (event: any): void => {
          const connectionMap = this.connectionMaps.get(page);
          if (!connectionMap) return;
          const reqId = String(event.requestId);
          const tracked = connectionMap.get(reqId);
          if (tracked) {
            tracked.connection.status = 'closed';
            tracked.connection.closedAt = Date.now();
          }
        };

        client.on('Network.webSocketCreated', onWsCreated);
        client.on('Network.webSocketFrameReceived', e =>
          onWsFrame(e, 'received'),
        );
        client.on('Network.webSocketFrameSent', e => onWsFrame(e, 'sent'));
        client.on('Network.webSocketClosed', onWsClosed);

        await client.send('Network.enable').catch(() => undefined);
      })
      .catch(() => undefined);
  }

  protected detachListeners(page: Page): void {
    safeDetach(page, this._onWebSocketHandlers, handler =>
      page.off('websocket', handler),
    );
    const client = this._cdpSessions.get(page);
    if (client) {
      this._cdpSessions.delete(page);
      client.detach().catch(() => undefined);
    }
    this.connectionMaps.delete(page);
    this.requestIdCounters.delete(page);
  }
}
