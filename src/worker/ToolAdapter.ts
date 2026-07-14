/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 将 MCP 工具请求适配到内部执行管线。
 *
 * @see {@link src/worker/ToolExecutionPipeline.ts} — 实际执行管线
 * @see {@link src/worker/ToolContext.ts} — 工具上下文提供者
 * @see {@link src/tools/ToolDefinition.ts} — defineTool 工具定义宏
 */

import {ToolPrerequisiteChecker} from '../tools/prerequisites/ToolPrerequisiteChecker.js';
import type {ToolMeta} from '../tools/tools-meta.js';
import type {ActionHandler} from '../types/rpc.js';
import type {ToolInvokeEvent} from '../web/types.js';

import {ToolCallContextGuard} from './ToolCallContextGuard.js';
import type {ToolContextProvider} from './ToolContext.js';
import {DefineToolContextFactory} from './ToolContext.js';
import {
  ToolExecutionPipeline,
  ToolExecutionRouter,
  ToolHandlerLoader,
} from './ToolExecutionPipeline.js';
import {ToolResponseProcessor, ToolTelemetry} from './ToolResponse.js';

export type ToolInvokeListener = (event: ToolInvokeEvent) => void;

export class ToolAdapter {
  private readonly loader: ToolHandlerLoader;
  private readonly defineToolContextFactory: DefineToolContextFactory;
  private readonly router: ToolExecutionRouter;
  private readonly pipeline: ToolExecutionPipeline;
  private readonly contextProvider: ToolContextProvider;

  constructor(contextProvider: ToolContextProvider) {
    this.contextProvider = contextProvider;
    this.loader = new ToolHandlerLoader();
    this.defineToolContextFactory = new DefineToolContextFactory(
      contextProvider,
    );
    this.router = new ToolExecutionRouter(
      contextProvider,
      this.defineToolContextFactory,
    );
    this.pipeline = new ToolExecutionPipeline(
      this.loader,
      this.router,
      new ToolResponseProcessor(),
      new ToolTelemetry(contextProvider),
      new ToolCallContextGuard(() => contextProvider),
      new ToolPrerequisiteChecker(contextProvider),
    );
  }

  /**
   * 将 Tool handler 包装为 Sekiro ActionHandler
   */
  wrapTool(meta: ToolMeta): ActionHandler {
    return async (rpcRequest, resolve, reject) => {
      try {
        resolve(await this.pipeline.execute(meta, rpcRequest.params || {}));
      } catch (error) {
        reject(error);
      }
    };
  }

  /**
   * 直接经内部 pipeline 执行工具（绕过 Sekiro Action 包装）。
   * 供 /api/v1 路由复用同一 pipeline 实例。
   * sessionId 在执行前后注入/清除 active session（v1 逻辑命名空间）。
   */
  async executeTool(
    meta: ToolMeta,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    if (sessionId) {
      this.contextProvider.setActiveSession?.(sessionId);
    }
    try {
      return await this.pipeline.execute(meta, params);
    } finally {
      if (sessionId) {
        this.contextProvider.clearActiveSession?.();
      }
    }
  }

  /**
   * 订阅 tool 调用事件。
   * 内部桥接 contextProvider.eventBus 的 tool:called / tool:error，
   * 把两种 payload 归一化为 ToolInvokeEvent 给上层（ConsoleServer / WsHub）使用。
   *
   * @returns 取消订阅函数（一次性取消两条订阅）
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
