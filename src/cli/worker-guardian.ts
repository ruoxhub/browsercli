/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkerGuardian — Worker 进程守护与健康状态管理
 *
 * 职责：
 * - 管理重启策略（max_restarts + restart_delay + restart_window）
 * - 追踪重启历史（次数 + 时间戳窗口）
 * - 判定是否允许自动重启
 * - 计算健康状态（healthy / degraded / unhealthy）
 */

export interface RestartPolicy {
  /** 时间窗口内最大重启次数（默认 5） */
  maxRestarts: number;
  /** 重启前等待延迟 ms（默认 2000） */
  restartDelayMs: number;
  /** 重启计数时间窗口 ms（默认 60000，即 1 分钟） */
  restartWindowMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxRestarts: 5,
  restartDelayMs: 2000,
  restartWindowMs: 60_000,
};

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface GuardianSnapshot {
  restartCount: number;
  totalRestarts: number;
  startTime: number | null;
  policy: RestartPolicy;
  health: HealthStatus;
}

export class WorkerGuardian {
  private restartTimestamps: number[] = [];
  private totalRestarts = 0;
  private startTime: number | null = null;
  private readonly policy: RestartPolicy;

  constructor(policy?: Partial<RestartPolicy>) {
    this.policy = {...DEFAULT_RESTART_POLICY, ...policy};
  }

  /** 记录 worker 启动 */
  markStarted(): void {
    this.startTime = Date.now();
  }

  /** 记录 worker 退出，返回是否应重启 */
  shouldRestart(exitCode: number | null, signal: string | null): boolean {
    // 正常退出（code=0 且无 signal）不重启
    if (exitCode === 0 && !signal) {
      return false;
    }

    const now = Date.now();

    // 清理窗口外的旧记录
    const windowStart = now - this.policy.restartWindowMs;
    this.restartTimestamps = this.restartTimestamps.filter(
      t => t >= windowStart,
    );

    // 记录本次退出
    this.restartTimestamps.push(now);
    this.totalRestarts++;

    // 检查是否超过窗口内最大重启次数
    if (this.restartTimestamps.length > this.policy.maxRestarts) {
      return false;
    }

    return true;
  }

  /** 获取重启前需等待的延迟 ms */
  getRestartDelay(): number {
    return this.policy.restartDelayMs;
  }

  /** 获取健康状态 */
  getHealth(): HealthStatus {
    const windowStart = Date.now() - this.policy.restartWindowMs;
    const recentRestarts = this.restartTimestamps.filter(
      t => t >= windowStart,
    ).length;

    if (recentRestarts === 0) return 'healthy';
    if (recentRestarts <= Math.ceil(this.policy.maxRestarts / 2)) return 'degraded';
    return 'unhealthy';
  }

  /** 获取当前守护快照 */
  getSnapshot(): GuardianSnapshot {
    return {
      restartCount: this.getRecentRestartCount(),
      totalRestarts: this.totalRestarts,
      startTime: this.startTime,
      policy: {...this.policy},
      health: this.getHealth(),
    };
  }

  /** 计算运行时长（秒），未启动返回 0 */
  getUptimeSeconds(): number {
    if (!this.startTime) return 0;
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /** 窗口内重启次数 */
  private getRecentRestartCount(): number {
    const windowStart = Date.now() - this.policy.restartWindowMs;
    return this.restartTimestamps.filter(t => t >= windowStart).length;
  }
}
