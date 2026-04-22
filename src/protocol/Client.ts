/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NodeClient — Node.js 端 Sekiro 客户端
 *
 * 替代浏览器端 BaseClient，删除所有浏览器绑定：
 * - 无 Chrome Storage 配置加载
 * - 无 window 域名检测
 * - 无 window.postMessage 桥接
 *
 * 职责：管理 Action 注册、SekiroClient 生命周期、连接/重连
 */

import {SekiroClient} from './sekiro.js';
import type {ActionHandler} from '../types/sekiro.js';
import type {NodeClientConfig, ClientStatus} from '../types/platform.js';

export class NodeClient {
  private sekiro: SekiroClient | null = null;
  private actions: Map<string, ActionHandler> = new Map();
  private readonly config: NodeClientConfig;
  private readonly clientId: string;
  private isInitialized = false;

  constructor(config: NodeClientConfig) {
    this.config = config;
    this.clientId = config.clientId || Math.random().toString(36).substring(2, 11);
  }

  /**
   * 统一日志
   */
  private log(message: string, level: 'log' | 'warn' | 'error' = 'log'): void {
    const prefix = `[NodeClient][${this.config.group}]`;
    const timestamp = new Date().toISOString();
    const fullMessage = `${timestamp} ${prefix} ${message}`;
    console[level](fullMessage);
  }

  /**
   * 构建 WebSocket 注册 URL
   */
  private buildWebSocketURL(): string {
    const host = this.config.sekiroHost || 'ws://127.0.0.1:5612';
    return `${host}/business/register?group=${this.config.group}&clientId=${this.clientId}`;
  }

  /**
   * 注册 Action
   */
  registerAction(name: string, handler: ActionHandler): void {
    if (this.actions.has(name)) {
      this.log(`Action "${name}" 已注册，将覆盖`, 'warn');
    }
    this.actions.set(name, handler);

    // 如果已连接，立即注册到 SekiroClient
    if (this.sekiro) {
      this.sekiro.registerAction(name, handler);
    }

    this.log(`注册 Action: ${name}`);
  }

  /**
   * 移除 Action
   */
  unregisterAction(name: string): boolean {
    const removed = this.actions.delete(name);
    if (removed && this.sekiro) {
      this.sekiro.unregisterAction(name);
    }
    return removed;
  }

  /**
   * 批量注册所有已缓存的 Actions 到 SekiroClient
   */
  private registerAllActions(): void {
    if (!this.sekiro) return;

    for (const [name, handler] of this.actions) {
      this.sekiro.registerAction(name, handler);
    }
    this.log(`注册了 ${this.actions.size} 个 Action`);
  }

  /**
   * 启动客户端 — 连接到 Sekiro Server
   */
  async start(): Promise<void> {
    try {
      const wsURL = this.buildWebSocketURL();
      this.log(`连接 Sekiro: ${wsURL}`);

      this.sekiro = new SekiroClient(wsURL, {
        reconnectBaseDelay: this.config.reconnectBaseDelay,
        reconnectMaxDelay: this.config.reconnectMaxDelay,
        heartbeatInterval: this.config.heartbeatInterval,
        onStateChange: (state) => {
          this.log(`连接状态变更: ${state}`);
          // 重连成功后重新注册所有 Actions
          if (state === 'connected') {
            this.registerAllActions();
          }
        },
      });

      this.registerAllActions();
      this.isInitialized = true;

      this.log('Sekiro 客户端初始化成功');
    } catch (error) {
      this.log(
        `Sekiro 客户端初始化失败：${error instanceof Error ? error.message : error}`,
        'error',
      );
      throw error;
    }
  }

  /**
   * 使用新地址重新连接
   */
  reconnect(newSekiroHost: string): void {
    this.log('正在重新连接...');
    this.config.sekiroHost = newSekiroHost;

    if (this.sekiro) {
      const wsURL = this.buildWebSocketURL();
      this.sekiro.reconnect(wsURL);
      this.log(`连接新地址：${wsURL}`);
    } else {
      // 未初始化则直接启动
      this.start().catch(err => {
        this.log(`重新连接失败：${err instanceof Error ? err.message : err}`, 'error');
      });
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.sekiro) {
      this.sekiro.disconnect();
      this.sekiro = null;
    }
    this.isInitialized = false;
    this.log('已断开连接');
  }

  /**
   * 获取客户端状态
   */
  getStatus(): ClientStatus {
    return {
      isInitialized: this.isInitialized,
      isConnected: this.sekiro?.isConnected() ?? false,
      connectionState: this.sekiro?.connectionState ?? 'disconnected',
      group: this.config.group,
      clientId: this.clientId,
      actionCount: this.actions.size,
      sekiroHost: this.config.sekiroHost,
    };
  }

  /**
   * 获取所有已注册的 Action 名称
   */
  getActionNames(): string[] {
    return Array.from(this.actions.keys());
  }
}
