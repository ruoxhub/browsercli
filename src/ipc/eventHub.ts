/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IPC 事件分发中心与协议类型。
 * 管理客户端（CLI / Socket）连接事件订阅与状态广播。
 */

// ==================== Channels ====================

/**
 * 状态类频道：订阅时立即回放最新快照（lastState），后续仅在状态变化时推送。
 */
export type StateChannel = 'worker.status' | 'browser.event';

/**
 * 流式频道：订阅后只推增量事件，不回放历史。
 */
export type StreamChannel =
  | 'tool.invoke'
  | 'hook.event'
  | 'hook.sample'
  | 'log';

export type Channel = StateChannel | StreamChannel;

export const STATE_CHANNELS: readonly StateChannel[] = [
  'worker.status',
  'browser.event',
];

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

// ==================== Messages ====================

export interface ClientMsgSubscribe {
  type: 'subscribe';
  channel: Channel;
  filter?: Record<string, unknown>;
}

export interface ClientMsgUnsubscribe {
  type: 'unsubscribe';
  channel: Channel;
}

export interface ClientMsgPing {
  type: 'ping';
}

export type ClientMsg =
  | ClientMsgSubscribe
  | ClientMsgUnsubscribe
  | ClientMsgPing;

export interface ServerMsgEvent {
  type: 'event';
  channel: Channel;
  ts: number;
  payload: unknown;
}

export interface ServerMsgSnapshot {
  type: 'snapshot';
  channel: StateChannel;
  ts: number;
  payload: unknown;
}

export interface ServerMsgError {
  type: 'error';
  channel?: Channel;
  code: string;
  message: string;
}

export interface ServerMsgPong {
  type: 'pong';
  ts: number;
}

export type ServerMsg =
  | ServerMsgEvent
  | ServerMsgSnapshot
  | ServerMsgError
  | ServerMsgPong;

// ==================== Payloads ====================

export interface HookSampleEvent {
  hookId: string;
  seq: number;
  ts: number;
  args?: unknown[];
  retVal?: unknown;
  stack?: Array<{
    url: string;
    line: number;
    col: number;
    functionName?: string;
  }>;
  truncated?: boolean;
  artifactRef?: string;
}

export interface ToolInvokeEvent {
  traceId: string;
  toolName: string;
  phase: 'end';
  ts: number;
  durationMs?: number;
  success: boolean;
  error?: {code: string; message: string};
}

// ==================== Hub & Sockets ====================

interface Subscription {
  channel: Channel;
  filter?: Record<string, unknown>;
}

type FilterFn = (sub: Subscription, ws: MinimalWebSocket) => boolean;

/**
 * 最小化 Socket / 连接抽象，仅依赖 send / readyState。
 */
export interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
}

export class WsHub {
  private readonly subscriptions = new Map<
    MinimalWebSocket,
    Set<Subscription>
  >();
  private readonly lastState = new Map<StateChannel, unknown>();

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

  unsubscribe(ws: MinimalWebSocket, channel: Channel): void {
    const set = this.subscriptions.get(ws);
    if (!set) return;
    for (const sub of set) {
      if (sub.channel === channel) set.delete(sub);
    }
    if (set.size === 0) this.subscriptions.delete(ws);
  }

  handleDisconnect(ws: MinimalWebSocket): void {
    this.subscriptions.delete(ws);
  }

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
      if (ws.readyState !== 1) continue;
      for (const sub of subs) {
        if (sub.channel !== channel) continue;
        if (filterFn && !filterFn(sub, ws)) continue;
        try {
          ws.send(text);
        } catch {
          // ignore error
        }
        break;
      }
    }
  }

  updateState(channel: StateChannel, payload: unknown): void {
    this.lastState.set(channel, payload);
  }

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

  clearState(channel?: StateChannel): void {
    if (channel) this.lastState.delete(channel);
    else this.lastState.clear();
  }

  private sendMsg(ws: MinimalWebSocket, msg: ServerMsg): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
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

export {WsHub as EventHub};
