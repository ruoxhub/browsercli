import type { Channel, ClientMsg, ServerMsg, ServerMsgEvent, ServerMsgSnapshot } from './protocol';

export type MessageHandler = (msg: ServerMsgEvent | ServerMsgSnapshot) => void;

class WebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private handlers = new Map<Channel, Set<MessageHandler>>();
  private activeFilters = new Map<Channel, Record<string, unknown> | undefined>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosedIntentionally = false;

  constructor() {
    this.url = this.getWsUrl();
  }

  private getWsUrl(): string {
    const { protocol, host, port } = window.location;
    if (port === '5173') {
      return 'ws://127.0.0.1:8765/ws';
    }
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${host}/ws`;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isClosedIntentionally = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('Failed to create WebSocket instance:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('WebSocket connected to', this.url);
      // 重新发送现有的所有订阅
      for (const [channel, filter] of this.activeFilters.entries()) {
        this.send({ type: 'subscribe', channel, filter });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMsg = JSON.parse(event.data);
        if (msg.type === 'event' || msg.type === 'snapshot') {
          const channelHandlers = this.handlers.get(msg.channel);
          if (channelHandlers) {
            for (const handler of channelHandlers) {
              try {
                handler(msg);
              } catch (err) {
                console.error(`Error in WebSocket handler for channel ${msg.channel}:`, err);
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`WebSocket closed (code: ${event.code}, reason: ${event.reason})`);
      this.ws = null;
      if (!this.isClosedIntentionally) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  public disconnect(): void {
    this.isClosedIntentionally = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('WebSocket is not open. Message not sent:', msg);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log('Scheduling WebSocket reconnect in 3 seconds...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  public subscribe(
    channel: Channel,
    handler: MessageHandler,
    filter?: Record<string, unknown>
  ): () => void {
    const key = channel; // 严格匹配 v2 规范，只用 channel 作为 key

    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }

    const handlerSet = this.handlers.get(key)!;
    handlerSet.add(handler);

    // 记录或者更新过滤条件（保存最新的过滤条件用于断线重连）
    this.activeFilters.set(channel, filter);

    // 如果是第一个 handler，且当前连接已开启，则发送 subscribe 消息
    if (handlerSet.size === 1) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'subscribe', channel, filter });
      }
    }

    return () => {
      const currentHandlers = this.handlers.get(key);
      if (currentHandlers) {
        currentHandlers.delete(handler);
        if (currentHandlers.size === 0) {
          this.handlers.delete(key);
          this.activeFilters.delete(channel);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'unsubscribe', channel });
          }
        }
      }
    };
  }
}

export const wsClient = new WebSocketClient();
export default wsClient;
