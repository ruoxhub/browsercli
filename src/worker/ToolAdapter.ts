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

import type {ActionHandler} from '../types/rpc.js';
import type {ToolMeta} from '../cli/tools-meta.js';
import {getAllToolNames, getToolMeta} from '../cli/tools-meta.js';
import {ToolResponseAccumulator} from './ToolResponseAccumulator.js';
import {ToolContextProvider} from './ToolContextProvider.js';

export class ToolAdapter {
  private contextProvider: ToolContextProvider;
  private loadedHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> = new Map();

  constructor(contextProvider: ToolContextProvider) {
    this.contextProvider = contextProvider;
  }

  /**
   * 动态加载 Tool handler
   */
  private async loadHandler(meta: ToolMeta): Promise<((...args: unknown[]) => Promise<unknown>) | null> {
    const cacheKey = `${meta.modulePath}:${meta.handlerName}`;
    if (this.loadedHandlers.has(cacheKey)) {
      return this.loadedHandlers.get(cacheKey)!;
    }

    try {
      // tools-meta 中的 modulePath 是相对于 tools/ 目录的，如 './dom.js'
      // 需要映射到实际路径: src/tools/dom.js → build/src/tools/dom.js
      const modulePath = `../tools${meta.modulePath.replace(/^\./, '')}`;
      const module = await import(modulePath);
      const handler = module[meta.handlerName];
      if (typeof handler !== 'function') {
        console.warn(`[ToolAdapter] ${cacheKey} handler 不是函数`);
        return null;
      }
      this.loadedHandlers.set(cacheKey, handler);
      return handler;
    } catch (err) {
      console.warn(`[ToolAdapter] 加载 ${cacheKey} 失败: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * 将 Tool handler 包装为 Sekiro ActionHandler
   */
  wrapTool(meta: ToolMeta): ActionHandler {
    return async (sekiroRequest, resolve, reject) => {
      const startTime = Date.now();
      const toolName = meta.name;

      try {
        const handler = await this.loadHandler(meta);
        if (!handler) {
          reject(`Tool handler 未找到: ${toolName}`);
          return;
        }

        const params = sekiroRequest.params || {};
        const page = this.contextProvider.getSelectedPage();
        const callMode = meta.callMode;

        // 根据 callMode 决定调用方式
        let result: unknown;
        if (callMode === 'runtime') {
          // 新模式：handler(runtimeServices, params)
          result = await handler(this.contextProvider, params);
        } else if (callMode === 'frame') {
          // 旧模式：handler(frame, params) — 优先使用选中的 Frame，回退到 Page 的 mainFrame
          const frame = this.contextProvider.getSelectedFrame()
            ?? page?.mainFrame()
            ?? null;
          if (frame) {
            result = await handler(frame, params);
          } else {
            reject(`Tool "${toolName}" 需要页面上下文，但当前没有可用页面`);
            return;
          }
        } else {
          // params-only 或未指定：handler(params)
          result = await handler(params);
        }

        const duration = Date.now() - startTime;
        console.log(`[Worker][ToolAdapter] action=${toolName} duration=${duration}ms status=ok`);

        // 包装结果
        const accumulator = new ToolResponseAccumulator();
        if (typeof result === 'object' && result !== null) {
          accumulator.setStructuredContent(result);
        } else if (typeof result === 'string') {
          accumulator.appendResponseLine(result);
        } else {
          accumulator.setStructuredContent(result);
        }

        resolve(accumulator.toJSON());
      } catch (err) {
        const duration = Date.now() - startTime;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`[Worker][ToolAdapter] action=${toolName} duration=${duration}ms status=err msg=${errMsg}`);
        reject(errMsg);
      }
    };
  }

  /**
   * 批量注册所有 Tools 为 Sekiro Actions
   */
  async registerAll(
    registerFn: (name: string, handler: ActionHandler) => void,
  ): Promise<void> {
    const toolNames = getAllToolNames();
    let registered = 0;

    for (const name of toolNames) {
      const meta = getToolMeta(name);
      if (!meta) continue;

      const handler = this.wrapTool(meta);
      registerFn(name, handler);
      registered++;
    }

    console.log(`[Worker][ToolAdapter] 注册了 ${registered}/${toolNames.length} 个 Tool`);
  }
}
