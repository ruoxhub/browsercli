/**
 * Sekiro WebSocket RPC 客户端
 */

import type { SekiroRequest, SekiroResponse, ActionHandler } from '../types/sekiro';

export class SekiroClient {
  private wsURL: string;
  private socket: WebSocket | null = null;
  private handlers: Map<string, ActionHandler> = new Map();
  private isManualDisconnect: boolean = false;
  private reconnectTimer: number | null = null;

  constructor(wsURL: string) {
    if (!wsURL) {
      throw new Error('wsURL 不能为空');
    }
    this.wsURL = wsURL;

    // 注册默认的 _execjs handler
    this.handlers.set('_execjs', this._execjsHandler.bind(this));

    this.connect();
  }

  /**
   * 默认 _execjs handler - 执行 JavaScript 代码
   */
  private _execjsHandler(
    request: SekiroRequest,
    resolve: (response: any) => void,
    reject: (error: string) => void
  ): void {
    // Sekiro 旧版本兼容：支持 param 和 code 字段
    const param = (request as any).param || request.params || (request as any).code || '';
    if (!param) {
      reject('缺少执行参数 param');
      return;
    }

    try {
      const fn = new Function('return (async () => { return ' + param + ' })()');
      const result = fn();

      if (result && typeof result.then === 'function') {
        (result as Promise<any>)
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
   * 连接 WebSocket
   */
  connect(): void {
    this.log(`正在连接 wsURL: ${this.wsURL}`);
    this.isManualDisconnect = false;

    try {
      this.socket = new WebSocket(this.wsURL);

      this.socket.onopen = (event: Event) => {
        this.log(`成功建立连接：${JSON.stringify(event)}`);
      };

      this.socket.onmessage = (event: MessageEvent) => {
        try {
          this.handleSekiroRequest(event.data);
        } catch (ex) {
          this.log(`处理消息异常：${ex}`);
        }
      };

      this.socket.onclose = (event: CloseEvent) => {
        if (this.isManualDisconnect) {
          this.log('连接已手动断开');
          return;
        }
        this.log(`连接断开，2 秒后重试：${JSON.stringify(event)}`);
        this.scheduleReconnect();
      };

      this.socket.onerror = (event: Event) => {
        this.log(`错误事件：${JSON.stringify(event)}`);
      };

    } catch (e) {
      this.log(`创建连接失败，2 秒后重试：${e}`);
      this.scheduleReconnect();
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.isManualDisconnect) {
        this.connect();
      }
    }, 2000);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.log('正在断开连接...');
    this.isManualDisconnect = true;

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
      handler(request,
        (response) => {
          try {
            this.sendSuccess(seq, response);
          } catch (e) {
            this.sendFailed(seq, `响应异常：${e}`);
          }
        },
        (errorMessage) => {
          this.sendFailed(seq, errorMessage);
        }
      );
    } catch (e) {
      this.log(`执行 action 处理函数异常：${e}`);
      this.sendFailed(seq, String(e));
    }
  }

  /**
   * 发送成功响应
   */
  private sendSuccess(seq: string, response: any): void {
    let responseJson: SekiroResponse;

    if (typeof response === 'string') {
      try {
        responseJson = JSON.parse(response);
      } catch (e) {
        responseJson = { data: response };
      }
    } else if (typeof response === 'object' && response !== null) {
      responseJson = response;
    } else {
      responseJson = { data: response };
    }

    // 确保是数组或字符串时包装为对象
    if (Array.isArray(responseJson) || typeof responseJson === 'string') {
      responseJson = { data: responseJson, code: 0 };
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
      __sekiro_seq__: seq
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
}

// 导出到 window 对象（用于 Content Script）
if (typeof window !== 'undefined') {
  (window as any).SekiroClient = SekiroClient;
}
