/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ExecutionContextTracker - Runtime 执行上下文追踪策略模块。
 *
 * 监听 Runtime.executionContextCreated / Destroyed / Cleared 事件，
 * 提供当前活跃执行上下文的查询能力。
 *
 * 与原 DebuggerContext 的 getExecutionContexts / getExecutionContextById 等价。
 * 通过 attachListeners / detachListeners 暴露，由 facade 在 init/disable 时调用。
 *
 * 重要：返回的 ExecutionContextInfo 必须填充 `world` / `extensionId`，
 * 否则 selectExecutionContext 的 `world === 'page'` 过滤会全部落空，
 * 导致 evaluate_script 走 runOnDebuggerContext 路径时 100% 失败。
 */

import type {CDPSession} from '../../third_party/index.js';
import type {
  ExecutionContextInfo,
  RawExecutionContextDescription,
} from './ExecutionContextInfo.js';
import {createExecutionContextInfo} from './ExecutionContextInfo.js';
import {logger} from '../../utils/logger.js';

interface ExecutionContextCreatedEvent {
  context: RawExecutionContextDescription;
}

interface ExecutionContextDestroyedEvent {
  executionContextId: number;
}

export class ExecutionContextTracker {
  private contexts = new Map<number, ExecutionContextInfo>();

  private createdListener:
    | ((params: ExecutionContextCreatedEvent) => void)
    | null = null;
  private destroyedListener:
    | ((params: ExecutionContextDestroyedEvent) => void)
    | null = null;
  private clearedListener: (() => void) | null = null;

  /** 注册 Runtime 域事件监听器。 */
  attachListeners(session: CDPSession): void {
    this.createdListener = params => this.handleCreated(params);
    this.destroyedListener = params => this.handleDestroyed(params);
    this.clearedListener = () => this.handleCleared();

    session.on('Runtime.executionContextCreated', this.createdListener);
    session.on('Runtime.executionContextDestroyed', this.destroyedListener);
    session.on('Runtime.executionContextsCleared', this.clearedListener);
  }

  /** 注销 Runtime 域事件监听器。 */
  detachListeners(session: CDPSession): void {
    if (this.createdListener) {
      session.off('Runtime.executionContextCreated', this.createdListener);
      this.createdListener = null;
    }
    if (this.destroyedListener) {
      session.off('Runtime.executionContextDestroyed', this.destroyedListener);
      this.destroyedListener = null;
    }
    if (this.clearedListener) {
      session.off('Runtime.executionContextsCleared', this.clearedListener);
      this.clearedListener = null;
    }
  }

  /** 内部状态清空。 */
  clearState(): void {
    this.contexts.clear();
  }

  private handleCreated(event: ExecutionContextCreatedEvent): void {
    const info = createExecutionContextInfo(event.context);
    this.contexts.set(info.id, info);
    logger.debug(
      `ExecutionContext created: id=${info.id}, name=${info.name}, world=${info.world}`,
    );
  }

  private handleDestroyed(event: ExecutionContextDestroyedEvent): void {
    this.contexts.delete(event.executionContextId);
    logger.debug(`ExecutionContext destroyed: id=${event.executionContextId}`);
  }

  private handleCleared(): void {
    this.contexts.clear();
    logger.debug('All execution contexts cleared');
  }

  getExecutionContexts(): ExecutionContextInfo[] {
    return Array.from(this.contexts.values());
  }

  getExecutionContextById(contextId: number): ExecutionContextInfo | undefined {
    return this.contexts.get(contextId);
  }
}
