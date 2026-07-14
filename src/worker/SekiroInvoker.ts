/**
 * @license
 * Copyright 2026 Browser-CLI
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
  rpcHost: string;
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
  /**
   * "no client available" 场景专用重试次数（默认 3）。
   * Worker 执行耗时操作期间 RPC 可能短暂断开，重连需等待，故单独给重试名额。
   */
  noClientRetries?: number;
  /** "no client available" 重试间隔 ms（默认 2000） */
  noClientRetryDelay?: number;
}

/** Sekiro 标准响应结构 */
interface RpcResponse {
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
  private readonly noClientRetries: number;
  private readonly noClientRetryDelay: number;

  /** 延时工具，便于测试时替换 / 统一语义 */
  private readonly delay = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

  constructor(config: SekiroInvokerConfig) {
    // rpcHost 是 WebSocket 地址如 ws://127.0.0.1:5612，需转为 HTTP
    // ws:// → http://, wss:// → https://
    this.baseUrl = config.rpcHost
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
      .replace(/\/$/, '');
    this.invokeTimeout = config.invokeTimeout ?? 30000;
    this.queryTimeout = config.queryTimeout ?? 5000;
    this.healthTimeout = config.healthTimeout ?? 3000;
    this.maxRetries = config.maxRetries ?? 1;
    this.retryDelay = config.retryDelay ?? 1000;
    this.noClientRetries = config.noClientRetries ?? 3;
    this.noClientRetryDelay = config.noClientRetryDelay ?? 2000;
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

    // 总尝试次数取两者较大值：保证 "no client available" 的重试名额不被
    // 普通网络抖动重试占满。Worker 重连需要时间，故专门给更长等待。
    const maxAttempts = Math.max(this.maxRetries, this.noClientRetries + 1);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.invokeTimeout),
        });

        if (!response.ok) {
          throw new Error(
            `Sekiro HTTP ${response.status}: ${await response.text()}`,
          );
        }

        const result = (await response.json()) as RpcResponse;

        // Sekiro 返回 status=-1 或 code=-1 表示失败
        if (result.status === -1 || result.code === -1) {
          const message = result.message || 'Sekiro action 执行失败';

          // Worker 未连接（正在重连）：等待后重试，给连接恢复窗口
          if (this.isNoClientAvailable(result)) {
            lastError = new Error(`Sekiro 无可用客户端：${message}`);
            // 用 noClientRetries 控制重试次数，而非 maxAttempts，
            // 避免被普通重试名额稀释（普通错误不会走此分支）
            if (attempt < this.noClientRetries) {
              await this.delay(this.noClientRetryDelay * (attempt + 1));
              continue;
            }
            throw lastError;
          }

          throw new Error(message);
        }

        return result.data ?? result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 不可重试的错误直接抛出
        if (
          error instanceof Error &&
          error.message.startsWith('Sekiro HTTP 4')
        ) {
          throw error;
        }

        // 普通网络抖动按计划重试（不超过 maxRetries 次）
        if (attempt < this.maxRetries - 1) {
          await this.delay(this.retryDelay * (attempt + 1));
          continue;
        }

        // 普通重试名额用尽即停止（no-client 错误不会进入此 catch 分支，
        // 它走上面的 try 分支），避免空转到 maxAttempts 放大故障
        break;
      }
    }

    throw lastError;
  }

  /**
   * 判定 Sekiro 响应是否为 "无可用客户端"。
   * Worker 因耗时操作断开、尚未重连完成时命中此分支（code 3001 / "no client available"）。
   */
  private isNoClientAvailable(result: RpcResponse): boolean {
    const message = (result.message ?? '').toLowerCase();
    return (
      message.includes('no client available') || message.includes('no client')
    );
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
   *
   * 优先使用根路径做轻量级连通性检查，失败后回退到 groupQueue。
   * 包含短暂重试以容忍服务初始化延迟。
   */
  async isServerAvailable(maxAttempts = 2): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if ((await this.probeRoot()) || (await this.probeClientQueue())) {
        return true;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return false;
  }

  /**
   * 获取实际请求的 HTTP baseUrl（用于错误信息展示）
   */
  getHttpUrl(): string {
    return this.baseUrl;
  }

  private async probeRoot(): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        signal: AbortSignal.timeout(this.healthTimeout),
      });
      return response.ok || response.status === 302;
    } catch {
      return false;
    }
  }

  private async probeClientQueue(group = 'healthcheck'): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/business/clientQueue?group=${encodeURIComponent(group)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.healthTimeout),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
