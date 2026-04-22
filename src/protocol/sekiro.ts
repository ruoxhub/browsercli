/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sekiro WebSocket RPC 客户端（Node.js 版）
 *
 * 改造自浏览器端 SekiroClient，核心变更：
 * - WebSocket 使用 ws 包替代浏览器原生 WebSocket
 * - 删除 window 依赖
 * - 新增指数退避重连
 * - 新增 ping/pong 心跳
 */

import WebSocket from 'ws';
import type {
  SekiroRequest,
  SekiroResponse,
  ActionHandler,
  SekiroConnectionState,
} from '../types/sekiro.js';

/** 默认配置 */
const DEFAULT_RECONNECT_BASE_DELAY = 2000;
const DEFAULT_RECONNECT_MAX_DELAY = 30000;
const DEFAULT_HEARTBEAT_INTERVAL = 30000;

export class SekiroClient {
  private wsURL: string;
  private socket: WebSocket | null = null;
  private handlers: Map<string, ActionHandler> = new Map();
  private isManualDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;

  // 可配置参数
  private readonly reconnectBaseDelay: number;
  private readonly reconnectMaxDelay: number;
  private readonly heartbeatInterval: number;

  // 连接状态
  private _connectionState: SekiroConnectionState = 'disconnected';
  private _onStateChange?: (state: SekiroConnectionState) => void;

  constructor(wsURL: string, options?: {
    reconnectBaseDelay?: number;
    reconnectMaxDelay?: number;
    heartbeatInterval?: number;
    onStateChange?: (state: SekiroConnectionState) => void;
  }) {
    if (!wsURL) {
      throw new Error('wsURL 不能为空');
    }
    this.wsURL = wsURL;
    this.reconnectBaseDelay = options?.reconnectBaseDelay ?? DEFAULT_RECONNECT_BASE_DELAY;
    this.reconnectMaxDelay = options?.reconnectMaxDelay ?? DEFAULT_RECONNECT_MAX_DELAY;
    this.heartbeatInterval = options?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL;
    this._onStateChange = options?.onStateChange;

    // 注册默认的 _execjs handler
    this.handlers.set('_execjs', this._execjsHandler.bind(this));

    this.connect();
  }

  /**
   * 默认 _execjs handler — 执行 JavaScript 代码
   */
  private _execjsHandler(
    request: SekiroRequest,
    resolve: (response: unknown) => void,
    reject: (error: string) => void,
  ): void {
    const extraFields = request as unknown as Record<string, unknown>;
    const param = extraFields.param
      || request.params
      || extraFields.code
      || '';
    if (!param) {
      reject('缺少执行参数 param');
      return;
    }

    try {
      const fn = new Function('return (async () => { return ' + param + ' })()');
      const result = fn();

      if (result && typeof result.then === 'function') {
        (result as Promise<unknown>)
          .then(res => resolve(res !== undefined ? res : '执行成功 (无返回值)'))
          .catch((err: unknown) => reject('执行错误：' + ((err as Error).message || err)));
      } else {
        resolve(result !== undefined ? result : '执行成功 (无返回值)');
      }
    } catch (err: unknown) {
      reject('语法错误：' + ((err as Error).message || err));
    }
  }

  /**
   * 日志输出
   */
  private log(message: string): void {
    console.log(`[SekiroClient] ${message}`);
  }

  /**
   * 更新连接状态
   */
  private setConnectionState(state: SekiroConnectionState): void {
    this._connectionState = state;
    this._onStateChange?.(state);
  }

  /**
   * 连接 WebSocket
   */
  connect(): void {
    this.log(`正在连接 wsURL: ${this.wsURL}`);
    this.isManualDisconnect = false;
    this.setConnectionState('connecting');

    try {
      this.socket = new WebSocket(this.wsURL);

      this.socket.onopen = () => {
        this.log('成功建立连接');
        this.setConnectionState('connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      };

      this.socket.onmessage = (event: WebSocket.MessageEvent) => {
        try {
          const data = typeof event.data === 'string'
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString('utf-8');
          this.handleSekiroRequest(data);
        } catch (ex) {
          this.log(`处理消息异常：${ex}`);
        }
      };

      this.socket.onclose = (event: WebSocket.CloseEvent) => {
        this.stopHeartbeat();

        if (this.isManualDisconnect) {
          this.log('连接已手动断开');
          this.setConnectionState('disconnected');
          return;
        }
        this.log(`连接断开 (code=${event.code})，将自动重连`);
        this.scheduleReconnect();
      };

      this.socket.onerror = (event: WebSocket.ErrorEvent) => {
        this.log(`WebSocket 错误：${event.message || '未知错误'}`);
      };

      // ws 包支持 pong 事件
      this.socket.on('pong', () => {
        // 心跳 pong 收到，连接正常
      });
    } catch (e) {
      this.log(`创建连接失败，将自动重连：${e}`);
      this.scheduleReconnect();
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatInterval <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.ping();
        } catch {
          this.log('心跳 ping 发送失败');
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 调度重连 — 指数退避
   */
  private scheduleReconnect(): void {
    if (this.isManualDisconnect) return;

    this.setConnectionState('reconnecting');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // 指数退避: base * 2^attempts，封顶 maxDelay
    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
      this.reconnectMaxDelay,
    );
    this.reconnectAttempts++;

    this.log(`${delay}ms 后重连 (attempt=${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isManualDisconnect) {
        this.connect();
      }
    }, delay);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.log('正在断开连接...');
    this.isManualDisconnect = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        this.log(`断开连接异常：${e}`);
      }
      this.socket = null;
    }

    this.setConnectionState('disconnected');
  }

  /**
   * 使用新地址重新连接
   */
  reconnect(newWsURL: string): void {
    this.log(`切换地址重连：${newWsURL}`);
    this.disconnect();
    this.wsURL = newWsURL;
    this.isManualDisconnect = false;
    this.connect();
  }

  /**
   * 处理 Sekiro 请求
   */
  private handleSekiroRequest(requestJson: string): void {
    let request: SekiroRequest;
    try {
      request = JSON.parse(requestJson);
    } catch (e) {
      this.log(`JSON 解析失败：${e}`);
      return;
    }

    const seq = request.__sekiro_seq__ || '';

    if (!request.action) {
      this.sendFailed(seq, '缺少 request 参数 {action}');
      return;
    }

    const action = request.action;
    const handler = this.handlers.get(action);

    if (!handler) {
      this.sendFailed(seq, `未定义 action 处理函数：${action}`);
      return;
    }

    try {
      handler(
        request,
        (response) => {
          try {
            this.sendSuccess(seq, response);
          } catch (e) {
            this.sendFailed(seq, `响应异常：${e}`);
          }
        },
        (errorMessage) => {
          this.sendFailed(seq, errorMessage);
        },
      );
    } catch (e) {
      this.log(`执行 action 处理函数异常：${e}`);
      this.sendFailed(seq, String(e));
    }
  }

  /**
   * 发送成功响应
   */
  private sendSuccess(seq: string, response: unknown): void {
    let responseJson: Record<string, unknown>;

    if (typeof response === 'string') {
      try {
        responseJson = JSON.parse(response) as Record<string, unknown>;
      } catch {
        responseJson = {data: response};
      }
    } else if (typeof response === 'object' && response !== null) {
      responseJson = response as Record<string, unknown>;
    } else {
      responseJson = {data: response};
    }

    // 确保是数组或字符串时包装为对象
    if (Array.isArray(responseJson) || typeof responseJson === 'string') {
      responseJson = {data: responseJson, code: 0};
    }

    responseJson.code = 0;
    responseJson.status = 0;
    responseJson.__sekiro_seq__ = seq;

    const responseText = JSON.stringify(responseJson);
    this.send(responseText);
  }

  /**
   * 发送失败响应
   */
  private sendFailed(seq: string, errorMessage: string): void {
    const responseJson: SekiroResponse = {
      message: errorMessage,
      status: -1,
      __sekiro_seq__: seq,
    };

    const responseText = JSON.stringify(responseJson);
    this.log(`返回失败信息：${responseText}`);
    this.send(responseText);
  }

  /**
   * 发送 WebSocket 消息
   */
  private send(message: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(message);
      } catch (e) {
        this.log(`发送消息异常：${e}`);
      }
    } else {
      this.log('WebSocket 未连接，无法发送消息');
    }
  }

  /**
   * 注册 Action 处理器
   */
  registerAction(action: string, handler: ActionHandler): SekiroClient {
    if (typeof action !== 'string') {
      throw new Error('action 类型必须为字符串');
    }
    if (typeof handler !== 'function') {
      throw new Error('handler 必须为函数类型');
    }

    this.log(`注册 action: ${action}`);
    this.handlers.set(action, handler);
    return this;
  }

  /**
   * 移除 Action 处理器
   */
  unregisterAction(action: string): boolean {
    return this.handlers.delete(action);
  }

  /**
   * 检查是否已注册某个 action
   */
  hasAction(action: string): boolean {
    return this.handlers.has(action);
  }

  /**
   * 获取所有已注册的 action 列表
   */
  getActions(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * 获取连接状态枚举
   */
  get connectionState(): SekiroConnectionState {
    return this._connectionState;
  }
}
