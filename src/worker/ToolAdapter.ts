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

export class ToolAdapter {
  private readonly loader: ToolHandlerLoader;
  private readonly defineToolContextFactory: DefineToolContextFactory;
  private readonly router: ToolExecutionRouter;
  private readonly pipeline: ToolExecutionPipeline;

  constructor(contextProvider: ToolContextProvider) {
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
}
