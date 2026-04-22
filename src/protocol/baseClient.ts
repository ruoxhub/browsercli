/**
 * BaseClient - 客户端基础框架类
 *
 * 用于统一管理所有平台客户端的通用逻辑，减少代码重复
 *
 * 使用方法:
 * 1. 创建平台配置对象
 * 2. 定义平台特定的 API 方法
 * 3. 配置 actions 映射
 * 4. 调用 BaseClient.create() 创建客户端
 */

import { SekiroClient } from './sekiro';
import type { ClientConfig, ResolvedConfig, ActionHandler, ActionConfig, SimpleActionHandler } from '../types/platform';

export type { SimpleActionHandler };

export class BaseClient {
  /**
   * 存储配置的键名
   */
  private static STORAGE_KEY = 'crawler_rpc_config';

  /**
   * 默认配置
   */
  private static defaultConfig: Partial<ResolvedConfig> = {
    // Sekiro 服务器地址 (默认值，可被存储配置覆盖)
    sekiroHost: 'ws://127.0.0.1:5612',
    // 延迟启动时间 (ms)
    startDelay: 2000,
    // 是否自动启动
    autoStart: true,
    // 日志前缀
    logPrefix: 'Client',
    // Action 延迟时间 (ms)，0 表示不延迟
    actionDelay: 0,
  };

  // 实例属性
  private config: ResolvedConfig;
  private platform: string;
  private group: string;
  private hostnames: string[];
  private actions: Record<string, SimpleActionHandler | ActionConfig>;
  private endpoints: Record<string, string>;
  private params: Record<string, any>;
  private client: SekiroClient | null;
  private isInitialized: boolean;

  // Action 延迟时间 (可动态更新)
  public actionDelay: number;

  /**
   * 从 Chrome Storage 加载配置 (通过桥接脚本)
   */
  private static async loadStoredConfig(): Promise<Record<string, any>> {
    return new Promise((resolve) => {
      const requestId = 'config_' + Math.random().toString(36).substr(2, 9);
      const timeout = 3000; // 3 秒超时
      let resolved = false;

      // 设置超时
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('[BaseClient] Config load timeout, using defaults');
          window.removeEventListener('message', messageHandler);
          resolve({});
        }
      }, timeout);

      // 消息处理函数
      function messageHandler(event: MessageEvent) {
        if (event.source !== window) return;

        const data = event.data;
        if (!data || data.source !== 'crawler_rpc_bridge') return;
        if (data.requestId !== requestId) return;

        // 找到匹配的响应
        resolved = true;
        clearTimeout(timeoutId);
        window.removeEventListener('message', messageHandler);

        if (data.success) {
          console.log('[BaseClient] Loaded stored config:', data.config);
          resolve(data.config || {});
        } else {
          console.log('[BaseClient] Failed to load config:', data.error);
          resolve({});
        }
      }

      // 监听响应
      window.addEventListener('message', messageHandler);

      // 发送请求到桥接脚本
      console.log('[BaseClient] Requesting config from bridge...');
      window.postMessage({
        source: 'crawler_rpc_main',
        action: 'getConfig',
        requestId: requestId
      }, '*');
    });
  }

  /**
   * 创建客户端实例
   */
  static create(config: ClientConfig): BaseClient {
    const mergedConfig = { ...this.defaultConfig, ...config } as ResolvedConfig;
    return new BaseClient(mergedConfig);
  }

  /**
   * 构造函数
   */
  constructor(config: ResolvedConfig) {
    this.config = config;
    this.platform = config.platform;
    this.group = config.group || config.platform;
    this.hostnames = Array.isArray(config.hostnames) ? config.hostnames : [config.hostnames];
    this.actions = config.actions || {};
    this.endpoints = config.endpoints || {};
    this.params = config.params || {};
    this.client = null;
    this.isInitialized = false;
    // Action 延迟时间 (可动态更新)
    this.actionDelay = config.actionDelay || 0;

    // 检查是否在正确的域名
    if (!this.isCorrectDomain()) {
      return;
    }

    this.log('正在初始化...');

    // 执行初始化回调
    if (typeof config.onInit === 'function') {
      config.onInit.call(this);
    }

    // 监听配置变更
    this.setupConfigChangeListener();

    // 自动启动
    if (config.autoStart !== false) {
      setTimeout(() => this.start(), config.startDelay || 2000);
    }
  }

  /**
   * 设置配置变更监听器
   */
  private setupConfigChangeListener(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;

      const data = event.data;
      if (!data || data.source !== 'crawler_rpc_bridge') return;

      // 监听配置更新广播
      if (data.action === 'configUpdated' && data.config) {
        this.log('收到配置更新通知');
        if (data.config.wsHost && data.config.wsHost !== this.config.sekiroHost) {
          this.log(`WebSocket 地址已变更：${this.config.sekiroHost} -> ${data.config.wsHost}`);
          this.reconnect(data.config.wsHost);
        }
        // 更新 Action 延迟配置
        if (typeof data.config.actionDelay === 'number') {
          this.actionDelay = data.config.actionDelay;
          this.log(`Action 延迟已更新：${this.actionDelay}ms`);
        }
      }
    });
  }

  /**
   * 检查当前页面是否在正确的域名
   */
  private isCorrectDomain(): boolean {
    const hostname = window.location.hostname;
    return this.hostnames.some(h => hostname.includes(h));
  }

  /**
   * 统一日志输出
   */
  private log(message: string, level: 'log' | 'warn' | 'error' = 'log'): void {
    const prefix = `[${this.config.logPrefix || this.platform}]`;
    const timestamp = new Date().toISOString();
    const fullMessage = `${timestamp} ${prefix} ${message}`;

    // 检查全局 logToConsole 函数（由 bridge.js 注入）
    const globalLogToConsole = (window as any).logToConsole;
    if (typeof globalLogToConsole === 'function') {
      globalLogToConsole(fullMessage);
    } else {
      console[level](fullMessage);
    }
  }

  /**
   * 启动 Sekiro 客户端
   */
  async start(): Promise<void> {
    try {
      // 在启动前加载存储的配置
      const storedConfig = await BaseClient.loadStoredConfig();
      if (storedConfig.wsHost) {
        this.config.sekiroHost = storedConfig.wsHost;
        this.log(`使用存储的 WebSocket 地址：${storedConfig.wsHost}`);
      }
      // 加载 Action 延迟配置
      if (typeof storedConfig.actionDelay === 'number') {
        this.actionDelay = storedConfig.actionDelay;
        this.log(`使用存储的 Action 延迟：${this.actionDelay}ms`);
      }

      const wsURL = this.buildWebSocketURL();
      this.log(`连接 Sekiro: ${wsURL}`);

      this.client = new SekiroClient(wsURL);
      this.registerAllActions();
      this.isInitialized = true;

      this.log('Sekiro 客户端初始化成功');
    } catch (error) {
      this.log(`Sekiro 客户端初始化失败：${error instanceof Error ? error.message : error}`, 'error');
    }
  }

  /**
   * 使用新地址重新连接
   */
  reconnect(newWsHost: string): void {
    this.log('正在重新连接...');

    // 断开当前连接
    if (this.client) {
      try {
        this.client.disconnect();
      } catch (error) {
        this.log(`断开连接失败：${error instanceof Error ? error.message : error}`, 'warn');
      }
    }

    // 更新配置
    this.config.sekiroHost = newWsHost;

    // 建立新连接
    const wsURL = this.buildWebSocketURL();
    this.log(`连接新地址：${wsURL}`);

    try {
      this.client = new SekiroClient(wsURL);
      this.registerAllActions();
      this.log('重新连接成功');
    } catch (error) {
      this.log(`重新连接失败：${error instanceof Error ? error.message : error}`, 'error');
    }
  }

  /**
   * 构建 WebSocket URL
   */
  private buildWebSocketURL(): string {
    const host = this.config.sekiroHost || 'ws://127.0.0.1:5612';
    const clientId = Math.random().toString(36).substr(2, 9);
    return `${host}/business/register?group=${this.group}&clientId=${clientId}`;
  }

  /**
   * 注册所有 actions
   */
  private registerAllActions(): void {
    for (const [actionName, actionConfig] of Object.entries(this.actions)) {
      this.registerAction(actionName, actionConfig);
    }
  }

  /**
   * 注册单个 action
   */
  private registerAction(actionName: string, actionConfig: SimpleActionHandler | ActionConfig): void {
    let handler: ActionHandler;

    if (typeof actionConfig === 'function') {
      // 直接传入处理函数 (SimpleActionHandler)
      handler = this.wrapHandler(actionConfig as (...args: any[]) => Promise<any>);
    } else if (typeof actionConfig === 'object') {
      // 配置对象形式
      const { method, transform } = actionConfig as ActionConfig;

      if (typeof method !== 'function') {
        this.log(`Action ${actionName} 缺少有效的 method`, 'warn');
        return;
      }

      handler = (request, resolve, reject) => {
        // 执行 action 的核心逻辑
        const executeAction = () => {
          // 提取 params 对象传入方法
          const params = request.params || {};
          (method as (...args: any[]) => Promise<any>)(params)
            .then(response => {
              // 可选的响应转换
              const result = typeof transform === 'function'
                ? transform(response)
                : response;
              resolve(result);
            })
            .catch(error => {
              reject(error.message || String(error));
            });
        };

        // 应用延迟（如果配置了延迟）
        const delay = this.actionDelay;
        if (delay > 0) {
          this.log(`Action ${actionName} 延迟 ${delay}ms 执行`);
          setTimeout(executeAction, delay);
        } else {
          executeAction();
        }
      };
    } else {
      this.log(`Action ${actionName} 配置无效`, 'warn');
      return;
    }

    if (this.client) {
      this.client.registerAction(actionName, handler);
      this.log(`注册 Action: ${actionName}${this.actionDelay > 0 ? ` (延迟 ${this.actionDelay}ms)` : ''}`);
    }
  }

  /**
   * 包装处理函数，添加错误处理
   */
  private wrapHandler(handler: (...args: any[]) => Promise<any>): ActionHandler {
    return async (request, resolve, reject) => {
      try {
        // 应用延迟（如果配置了延迟）
        const delay = this.actionDelay;
        if (delay > 0) {
          this.log(`Handler 延迟 ${delay}ms 执行`);
          await new Promise(r => setTimeout(r, delay));
        }
        // 提取 params 对象传入方法
        const params = request.params || {};
        const result = await handler.call(this, params);
        resolve(result);
      } catch (error) {
        reject(error instanceof Error ? error.message : String(error));
      }
    };
  }

  /**
   * 获取客户端状态
   */
  getStatus(): { isInitialized: boolean; isConnected: boolean; platform: string } {
    return {
      isInitialized: this.isInitialized,
      isConnected: this.client?.isConnected() || false,
      platform: this.platform
    };
  }
}

/**
 * 辅助函数：创建标准 Action 配置
 * 用于简化 action 配置的创建
 */
export function createAction(
  method: (...args: any[]) => Promise<any>,
  transform?: ((response: any) => any) | null
): ActionConfig {
  return { method, transform };
}

/**
 * 辅助函数：创建带默认值的参数配置
 */
export function param(name: string, defaultValue: any = undefined): { name: string; default: any } {
  return { name, default: defaultValue };
}

// 导出到 window 对象（用于 Content Script）
if (typeof window !== 'undefined') {
  (window as any).BaseClient = BaseClient;
  (window as any).createAction = createAction;
  (window as any).param = param;
}
