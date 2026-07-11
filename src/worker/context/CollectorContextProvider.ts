/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CollectorContextProvider — 网络/Console/WebSocket 三个 PageCollector 的 Facade/Provider
 *
 * 职责：
 * - 统一创建/销毁 NetworkRequestCollector、ConsoleMessageCollector、WsCollector
 * - 在 BrowserContext 就绪后启动上下文级别的新页面自动注册
 * - 对外暴露数据查询 API
 */

import type {
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
} from 'patchright';

import type {PageCollector} from '../../modules/collector/PageCollector.js';
import type {HTTPRequest} from '../../third_party/index.js';
import type {WebSocketData} from '../../modules/network/NetworkTypes.js';
import {
  ConsoleMessageCollector,
  NetworkRequestCollector,
  WsCollector,
  type TrackedRequest,
  type TrackedConsoleMessage,
  type TrackedWebSocketData,
} from '../collectors.js';

export class CollectorContextProvider {
  private readonly _networkCollector = new NetworkRequestCollector();
  private readonly _consoleCollector = new ConsoleMessageCollector();
  private readonly _wsCollector = new WsCollector();

  private readonly _maxNavigationSaved = 3;
  private _started = false;

  // ─── 生命周期 ────────────────────────────────────────

  get networkCollector(): NetworkRequestCollector {
    return this._networkCollector;
  }

  get consoleCollector(): ConsoleMessageCollector {
    return this._consoleCollector;
  }

  get wsCollector(): WsCollector {
    return this._wsCollector;
  }

  /**
   * 启动上下文级别的收集（监听新页面创建、为已有页面注册收集器）。
   */
  start(context: BrowserContext): void {
    this._networkCollector.startContextCollection(context);
    this._consoleCollector.startContextCollection(context);
    this._wsCollector.startContextCollection(context);
    this._started = true;
  }

  /**
   * 为单个 Page 手动注册收集器。
   */
  attachPage(page: Page): void {
    this._networkCollector.attachToPage(page);
    this._consoleCollector.attachToPage(page);
    this._wsCollector.attachToPage(page);
  }

  dispose(): void {
    this._networkCollector.dispose();
    this._consoleCollector.dispose();
    this._wsCollector.dispose();
    this._started = false;
  }

  isStarted(): boolean {
    return this._started;
  }

  // ─── Network 数据查询 ────────────────────────────────

  getNetworkRequests(
    page: Page | null,
    includePreservedRequests = false,
  ): HTTPRequest[] {
    if (!page) return [];
    const navigations = this._networkCollector.getNavigations(page);
    if (!navigations) return [];

    if (!includePreservedRequests) {
      return navigations[0]!.map(t => t.request as unknown as HTTPRequest);
    }

    const requests: HTTPRequest[] = [];
    for (let i = this._maxNavigationSaved - 1; i >= 0; i--) {
      if (navigations[i]) {
        requests.push(
          ...navigations[i]!.map(t => t.request as unknown as HTTPRequest),
        );
      }
    }
    return requests;
  }

  getNetworkRequestById(candidatePages: Page[], reqid: number): HTTPRequest {
    if (candidatePages.length === 0) {
      throw new Error('未选中页面');
    }
    const found = this._networkCollector.getById(reqid, candidatePages);
    if (!found) {
      throw new Error(`请求 ID ${reqid} 未找到`);
    }
    return found.request as unknown as HTTPRequest;
  }

  /**
   * 清空指定页面的网络请求缓存。
   *
   * 调用后该页面已收集到的所有网络请求会从当前导航段中移除，
   * 稳定 ID 计数器也会重置——后续新产生的请求会从 1 重新分配 stableId。
   *
   * 监听器（page.on('request', …)）保持挂载状态，新事件继续按原样收集。
   */
  clearNetworkRequests(page: Page | null): void {
    if (!page) return;
    this._networkCollector.clear(page);
  }

  getNetworkRequestStableId(
    candidatePages: Page[],
    request: unknown,
  ): number {
    const found = this._networkCollector.findBy(
      candidatePages,
      (t: TrackedRequest) => t.request === (request as Request),
    );
    return found?.stableId ?? -1;
  }

  // ─── Console 数据查询 ────────────────────────────────

  getConsoleData(
    page: Page | null,
    includePreservedMessages = false,
  ): Array<ConsoleMessage | Error> {
    if (!page) return [];
    const navigations = this._consoleCollector.getNavigations(page);
    if (!navigations) return [];

    if (!includePreservedMessages) {
      return navigations[0]!.map(t => t.message);
    }

    const data: Array<ConsoleMessage | Error> = [];
    for (let i = this._maxNavigationSaved; i >= 0; i--) {
      if (navigations[i]) {
        data.push(...navigations[i]!.map(t => t.message));
      }
    }
    return data;
  }

  getConsoleMessageById(
    page: Page | null,
    id: number,
  ): ConsoleMessage | Error {
    return this.findById(
      this._consoleCollector,
      page,
      id,
      'Console',
      t => t.stableId === id,
      t => t.message,
    );
  }

  getConsoleMessageStableId(
    candidatePages: Page[],
    message: unknown,
  ): number {
    const found = this._consoleCollector.findBy(
      candidatePages,
      (t: TrackedConsoleMessage) => t.message === message,
    );
    return found?.stableId ?? -1;
  }

  // ─── WebSocket 数据查询 ──────────────────────────────

  getWebSocketConnections(
    page: Page | null,
    includePreservedData = false,
  ): WebSocketData[] {
    if (!page) return [];
    const navigations = this._wsCollector.getNavigations(page);
    if (!navigations) return [];

    if (!includePreservedData) {
      return navigations[0] ?? [];
    }

    const data: WebSocketData[] = [];
    for (let i = this._maxNavigationSaved; i >= 0; i--) {
      if (navigations[i]) {
        data.push(...navigations[i]);
      }
    }
    return data;
  }

  getWebSocketConnectionById(page: Page | null, wsid: number): WebSocketData {
    return this.findById(
      this._wsCollector,
      page,
      wsid,
      'WebSocket',
      t => t.stableId === wsid,
      t => t,
    );
  }

  getWebSocketStableId(candidatePages: Page[], ws: unknown): number {
    const found = this._wsCollector.findBy(
      candidatePages,
      (t: TrackedWebSocketData) => t === ws,
    );
    return found?.stableId ?? -1;
  }

  // ─── 辅助方法 ──────────────────────────────────────────

  private findById<T extends {stableId: number}, R>(
    collector: PageCollector<T>,
    page: Page | null,
    id: number,
    typeName: string,
    predicate: (item: T) => boolean,
    extract: (item: T) => R,
  ): R {
    if (!page) throw new Error('未选中页面');
    const navigations = collector.getNavigations(page);
    if (!navigations) throw new Error(`${typeName} 收集器未初始化`);
    for (const navigation of navigations) {
      const found = navigation.find(predicate);
      if (found) return extract(found);
    }
    throw new Error(`${typeName} ID ${id} 未找到`);
  }
}
