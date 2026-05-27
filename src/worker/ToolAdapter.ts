/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolAdapter — 将现有 Tool handler 包装为 Sekiro ActionHandler
 *
 * Tool handler 签名: handler(params, runtimeServices) => Promise<result>
 * Sekiro Action 签名: handler(request, resolve, reject) => void
 *
 * 通过 tools-meta.ts 中的 ToolMeta 动态加载 handler，适配为 Action
 *
 * 此外，对外暴露 onInvoke(listener) 用于监听 tool 调用事件，
 * 内部桥接 contextProvider.eventBus 的 tool:called / tool:error。
 * Phase 3 ConsoleServer 通过此入口把事件广播到 WebSocket。
 */

import type {ToolMeta} from '../cli/tools-meta.js';
import {
  ensureToolsMeta,
  getAllToolNames,
  getToolMeta,
} from '../cli/tools-meta.js';
import {ToolPrerequisiteChecker} from '../tools/prerequisites/ToolPrerequisiteChecker.js';
import type {ActionHandler} from '../types/rpc.js';

import {DefineToolContextFactory} from './DefineToolContextFactory.js';
import {ToolCallContextGuard} from './ToolCallContextGuard.js';
import type {ToolContextProvider} from './ToolContextProvider.js';
import {ToolExecutionPipeline} from './ToolExecutionPipeline.js';
import {ToolExecutionRouter} from './ToolExecutionRouter.js';
import {ToolHandlerLoader} from './ToolHandlerLoader.js';
import {ToolResponseOffloader} from './ToolResponseOffloader.js';
import {ToolTelemetry} from './ToolTelemetry.js';

/**
 * 跨 worker / web 边界的统一 tool 调用事件 payload。
 * Phase 1 (T1) 会被 src/web/types.ts re-export 给前端用。
 */
export interface ToolInvokeEvent {
  traceId: string;
  toolName: string;
  phase: 'end';
  ts: number;
  durationMs?: number;
  success: boolean;
  error?: {code: string; message: string};
}

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
      new ToolResponseOffloader(),
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
   * 批量注册所有 Tools 为 Sekiro Actions
   */
  async registerAll(
    registerFn: (name: string, handler: ActionHandler) => void,
  ): Promise<void> {
    await ensureToolsMeta();
    const toolNames = getAllToolNames();
    let registered = 0;

    for (const name of toolNames) {
      const meta = getToolMeta(name);
      if (!meta) continue;

      const handler = this.wrapTool(meta);
      registerFn(name, handler);
      registered++;
    }

    console.log(
      `[Worker][ToolAdapter] 注册了 ${registered}/${toolNames.length} 个 Tool`,
    );
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
