/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SekiroInvoker — Sekiro HTTP API 调用方
 *
 * CLI 层通过 HTTP POST 调用 Sekiro Server 的 /business/invoke 端点，
 * Server 路由到 Worker 执行并返回结果
 *
 * 改进：
 * - 可配置超时（不再硬编码）
 * - invoke 支持自动重试（网络抖动容忍）
 * - 响应类型安全
 */

/** SekiroInvoker 配置 */
interface SekiroInvokerConfig {
  sekiroHost: string;
  /** invoke 超时 ms（默认 30000） */
  invokeTimeout?: number;
  /** 查询类操作超时 ms（默认 5000） */
  queryTimeout?: number;
  /** 健康检查超时 ms（默认 3000） */
  healthTimeout?: number;
  /** invoke 最大重试次数（默认 1，即不重试） */
  maxRetries?: number;
  /** 重试间隔 ms（默认 1000） */
  retryDelay?: number;
}

/** Sekiro 标准响应结构 */
interface SekiroResponse {
  code?: number;
  status?: number;
  message?: string;
  data?: unknown;
}

export class SekiroInvoker {
  private baseUrl: string;
  private readonly invokeTimeout: number;
  private readonly queryTimeout: number;
  private readonly healthTimeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(config: SekiroInvokerConfig) {
    // sekiroHost 是 WebSocket 地址如 ws://127.0.0.1:5612，需转为 HTTP
    this.baseUrl = config.sekiroHost
      .replace(/^ws/, 'http')
      .replace(/\/$/, '');
    this.invokeTimeout = config.invokeTimeout ?? 30000;
    this.queryTimeout = config.queryTimeout ?? 5000;
    this.healthTimeout = config.healthTimeout ?? 3000;
    this.maxRetries = config.maxRetries ?? 1;
    this.retryDelay = config.retryDelay ?? 1000;
  }

  /**
   * 调用 Sekiro Action（带自动重试）
   */
  async invoke(
    group: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}/business/invoke`;
    const body = {
      group,
      action,
      ...(params && {params}),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.invokeTimeout),
        });

        if (!response.ok) {
          throw new Error(`Sekiro HTTP ${response.status}: ${await response.text()}`);
        }

        const result = await response.json() as SekiroResponse;

        // Sekiro 返回 status=-1 或 code=-1 表示失败
        if (result.status === -1 || result.code === -1) {
          throw new Error(result.message || 'Sekiro action 执行失败');
        }

        return result.data ?? result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 不可重试的错误直接抛出
        if (error instanceof Error && error.message.startsWith('Sekiro HTTP 4')) {
          throw error;
        }

        // 还有重试机会，等待后继续
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, this.retryDelay * (attempt + 1)));
        }
      }
    }

    throw lastError;
  }

  /**
   * 列出指定 group 的在线客户端
   */
  async listClients(group: string): Promise<unknown> {
    const url = `${this.baseUrl}/business/clientQueue?group=${encodeURIComponent(group)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.queryTimeout),
    });

    if (!response.ok) {
      throw new Error(`Sekiro HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * 列出所有 group
   */
  async listGroups(): Promise<unknown> {
    const url = `${this.baseUrl}/business/groupQueue`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.queryTimeout),
    });

    if (!response.ok) {
      throw new Error(`Sekiro HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * 检查 Sekiro Server 是否可用
   */
  async isServerAvailable(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/business/groupQueue`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.healthTimeout),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
