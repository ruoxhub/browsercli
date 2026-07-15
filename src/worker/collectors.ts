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
  }

  protected detachListeners(page: Page): void {
    safeDetach(page, this._onWebSocketHandlers, handler =>
      page.off('websocket', handler),
    );
    this.connectionMaps.delete(page);
    this.requestIdCounters.delete(page);
  }
}
