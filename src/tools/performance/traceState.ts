/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession} from '../../third_party/index.js';

/**
 * 跨 start_performance_trace / stop_performance_trace 共享的追踪状态。
 *
 * 关键约束：Chrome 的 Tracing 数据（Tracing.dataCollected）只投递到调用
 * Tracing.start 的那个 CDP 会话。若 start 与 stop 使用不同会话，end 会因
 * “当前没有正在进行的追踪”而报错。因此 start 创建的会话必须保持存活，
 * 直到 stop 显式结束并 detach。
 */

let activeClient: CDPSession | null = null;
let chunks: string[] = [];

/**
 * 在发起 Tracing.start 的会话上注册数据收集监听，并记为活跃会话。
 * 必须在调用 Tracing.start 之前调用，确保不丢早期数据。
 */
export function beginTrace(client: CDPSession): void {
  activeClient = client;
  chunks = [];
  client.on('event', (data: {method: string; params?: Record<string, unknown>}) => {
    if (data.method === 'Tracing.dataCollected' && data.params) {
      chunks.push((data.params as {value: string}).value);
    }
  });
}

export function getTraceClient(): CDPSession | null {
  return activeClient;
}

export function getTraceChunks(): string[] {
  return chunks;
}

/** 结束追踪并清空状态（无论成功失败都应调用）。 */
export function endTrace(): void {
  activeClient = null;
  chunks = [];
}

/**
 * 等待 Tracing.tracingComplete 事件，带超时保护。
 */
export function waitForTracingComplete(
  client: CDPSession,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    const handler = (data: {method: string}) => {
      if (data.method === 'Tracing.tracingComplete') {
        clearTimeout(timer);
        client.off('event', handler);
        resolve();
      }
    };
    client.on('event', handler);
  });
}
