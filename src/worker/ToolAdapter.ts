/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolAdapter — 工具执行适配层（ADR-0008 / ADR-0009）
 *
 * 所有标准 defineTool / definePageTool / defineBrowserTool / defineStatelessTool
 * 均直连单一直线引擎 ToolExecutor；仅对遗留测试夹具（callMode !== 'defineTool'）
 * 保留旧管线回退。
 */

import type {ToolInvokeEvent} from '../ipc/eventHub.js';
import {ToolPrerequisiteChecker} from '../tools/prerequisites/ToolPrerequisiteChecker.js';
import type {ToolMeta} from '../tools/tools-meta.js';

import type {SessionContext} from './SessionContext.js';
import {ToolCallContextGuard} from './ToolCallContextGuard.js';
import {DefineToolContextFactory} from './ToolContext.js';
import {
  ToolExecutionPipeline,
  ToolExecutionRouter,
  ToolHandlerLoader,
} from './ToolExecutionPipeline.js';
import {ToolExecutor} from './ToolExecutor.js';
import {ToolResponseProcessor, ToolTelemetry} from './ToolResponse.js';

export type ToolInvokeListener = (event: ToolInvokeEvent) => void;

export class ToolAdapter {
  private readonly executor: ToolExecutor;
  private readonly legacyPipeline: ToolExecutionPipeline;
  private readonly contextProvider: SessionContext;

  constructor(contextProvider: SessionContext) {
    this.contextProvider = contextProvider;
    const processor = new ToolResponseProcessor();
    const telemetry = new ToolTelemetry(contextProvider);
    const contextGuard = new ToolCallContextGuard(() => contextProvider);
    const prerequisiteChecker = new ToolPrerequisiteChecker(
      contextProvider,
      contextProvider.healthTracker,
    );

    this.executor = new ToolExecutor({
      session: contextProvider,
      processor,
      telemetry,
      contextGuard,
      prerequisiteChecker,
      healthTracker: contextProvider.healthTracker,
    });

    const loader = new ToolHandlerLoader();
    const defineToolContextFactory = new DefineToolContextFactory(
      contextProvider,
    );
    const router = new ToolExecutionRouter(
      contextProvider,
      defineToolContextFactory,
      contextProvider.healthTracker,
    );
    this.legacyPipeline = new ToolExecutionPipeline(
      loader,
      router,
      processor,
      telemetry,
      contextGuard,
      prerequisiteChecker,
      undefined,
      undefined,
      contextProvider.healthTracker,
      contextProvider,
    );
  }

  /**
   * 直接经内部 ToolExecutor 执行工具（遗留非 defineTool 夹具走兼容管线）。
   */
  async executeTool(
    meta: ToolMeta,
    params: Record<string, unknown>,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (sessionId) {
      this.contextProvider.setActiveSession?.(sessionId);
    }
    try {
      if (meta.callMode === 'defineTool') {
        return await this.executor.execute(meta, params, signal);
      }
      return await this.legacyPipeline.execute(meta, params, signal);
    } finally {
      if (sessionId) {
        this.contextProvider.clearActiveSession?.();
      }
    }
  }

  /**
   * 订阅 tool 调用事件。
   */
  onInvoke(listener: ToolInvokeListener): () => void {
    const unsubscribeCalled = this.contextProvider.eventBus.on(
      'tool:called',
      payload => {
        listener({
          traceId: payload.traceId,
          toolName: payload.name,
          phase: 'end',
          ts: Date.now(),
          durationMs: payload.durationMs,
          success: true,
        });
      },
    );
    const unsubscribeError = this.contextProvider.eventBus.on(
      'tool:error',
      payload => {
        listener({
          traceId: payload.traceId,
          toolName: payload.name,
          phase: 'end',
          ts: Date.now(),
          success: false,
          error: {code: payload.code, message: payload.message},
        });
      },
    );
    return () => {
      unsubscribeCalled();
      unsubscribeError();
    };
  }
}
