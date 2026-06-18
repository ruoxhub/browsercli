/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WebSocket 连接中心。管理客户端连接，分发事件到 ConsoleServer 和 RestRouter。
 *
 * @see {@link src/web/ConsoleServer.ts} — 通过 WsHub 推送 console/hook 事件
 * @see {@link src/web/RestRouter.ts} — HTTP REST 路由，与 WsHub 共享端口
 * @see {@link src/web/types.ts} — WebSocket 消息类型定义
 */

import type {WebSocket} from 'ws';

import {
  STATE_CHANNELS,
  type Channel,
  type ClientMsg,
  type ServerMsg,
  type StateChannel,
} from '../types.js';

interface Subscription {
  channel: Channel;
  filter?: Record<string, unknown>;
}

type FilterFn = (sub: Subscription, ws: WebSocket) => boolean;

/**
 * 最小化 WebSocket 抽象，仅依赖 send / readyState。
 * 让 WsHub 在测试中可以用纯对象 mock，无需起真实 ws server。
 */
export interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
}

const STATE_CHANNEL_SET: ReadonlySet<Channel> = new Set<Channel>(
  STATE_CHANNELS,
);

function isStateChannel(channel: Channel): channel is StateChannel {
  return STATE_CHANNEL_SET.has(channel);
}

const VALID_CHANNELS: ReadonlySet<Channel> = new Set<Channel>([
  ...STATE_CHANNELS,
  'tool.invoke',
  'hook.event',
  'hook.sample',
  'log',
]);

export class WsHub {
  /** 每个连接的活跃订阅集合。 */
  private readonly subscriptions = new Map<MinimalWebSocket, Set<Subscription>>();
  /** state 频道的最新快照，订阅时回放。 */
  private readonly lastState = new Map<StateChannel, unknown>();

  /**
   * 客户端订阅；若是 state 频道，立即回放最新快照（若已存在）。
   */
  subscribe(
    ws: MinimalWebSocket,
    channel: Channel,
    filter?: Record<string, unknown>,
  ): void {
    if (!VALID_CHANNELS.has(channel)) {
      this.sendError(ws, 'INVALID_CHANNEL', `未知频道: ${channel}`, channel);
      return;
    }

    let set = this.subscriptions.get(ws);
    if (!set) {
      set = new Set();
      this.subscriptions.set(ws, set);
    }
    set.add({channel, filter});

    if (isStateChannel(channel)) {
      const snapshot = this.lastState.get(channel);
      if (snapshot !== undefined) {
        this.sendMsg(ws, {
          type: 'snapshot',
          channel,
          ts: Date.now(),
          payload: snapshot,
        });
      }
    }
  }

  /**
   * 取消订阅指定频道（同 channel 的所有 filter 一并清掉，简化协议）。
   */
  unsubscribe(ws: MinimalWebSocket, channel: Channel): void {
    const set = this.subscriptions.get(ws);
    if (!set) return;
    for (const sub of set) {
      if (sub.channel === channel) set.delete(sub);
    }
    if (set.size === 0) this.subscriptions.delete(ws);
  }

  /**
   * 处理断开：清理所有订阅。WsHub 自身不监听 ws.close，由调用方在
   * close 事件里调用此方法。
   */
  handleDisconnect(ws: MinimalWebSocket): void {
    this.subscriptions.delete(ws);
  }

  /**
   * 广播事件给所有订阅了该 channel 且通过 filterFn 的连接。
   * 若是 state 频道，先把 payload 写入 lastState。
   */
  broadcast(channel: Channel, payload: unknown, filterFn?: FilterFn): void {
    if (!VALID_CHANNELS.has(channel)) return;

    if (isStateChannel(channel)) {
      this.lastState.set(channel, payload);
    }

    const msg: ServerMsg = {
      type: 'event',
      channel,
      ts: Date.now(),
      payload,
    };
    const text = JSON.stringify(msg);

    for (const [ws, subs] of this.subscriptions) {
      // ws.OPEN === 1，硬编码避免依赖 ws 模块常量在 mock 时不可用
      if (ws.readyState !== 1) continue;
      for (const sub of subs) {
        if (sub.channel !== channel) continue;
        if (filterFn && !filterFn(sub, ws as WebSocket)) continue;
        try {
          ws.send(text);
        } catch {
          // 一次 send 失败不影响其它订阅者；下次 broadcast 会自然过滤掉已断开的连接
        }
        break; // 同一 channel 即使多次订阅，只发一份
      }
    }
  }

  /**
   * 主动更新 state 频道快照（不一定要 broadcast；某些场景只需要刷新初始值）。
   * 调用时若需要同时通知现有订阅者，请改用 broadcast。
   */
  updateState(channel: StateChannel, payload: unknown): void {
    this.lastState.set(channel, payload);
  }

  /**
   * 处理来自客户端的协议消息。返回 boolean 仅供测试断言；生产端忽略。
   */
  handleClientMessage(ws: MinimalWebSocket, raw: string): boolean {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      this.sendError(ws, 'INVALID_JSON', '消息体不是合法 JSON');
      return false;
    }

    switch (msg.type) {
      case 'subscribe':
        this.subscribe(ws, msg.channel, msg.filter);
        return true;
      case 'unsubscribe':
        this.unsubscribe(ws, msg.channel);
        return true;
      case 'ping':
        this.sendMsg(ws, {type: 'pong', ts: Date.now()});
        return true;
      default:
        this.sendError(
          ws,
          'UNKNOWN_TYPE',
          `未知消息类型: ${(msg as {type?: string}).type ?? 'undefined'}`,
        );
        return false;
    }
  }

  /** 当前订阅了某 channel 的连接数（测试/诊断用）。 */
  getSubscriberCount(channel: Channel): number {
    let n = 0;
    for (const subs of this.subscriptions.values()) {
      for (const sub of subs) {
        if (sub.channel === channel) {
          n++;
          break;
        }
      }
    }
    return n;
  }

  /** 主动注销已知 lastState（一般无需手动调用，进程重启即清）。 */
  clearState(channel?: StateChannel): void {
    if (channel) this.lastState.delete(channel);
    else this.lastState.clear();
  }

  private sendMsg(ws: MinimalWebSocket, msg: ServerMsg): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 发送失败不影响 hub 自身状态
    }
  }

  private sendError(
    ws: MinimalWebSocket,
    code: string,
    message: string,
    channel?: Channel,
  ): void {
    this.sendMsg(ws, {
      type: 'error',
      code,
      message,
      ...(channel ? {channel} : {}),
    });
  }
}
