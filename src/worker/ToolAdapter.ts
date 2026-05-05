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
import {getAllToolNames, getToolMeta} from '../cli/tools-meta.js';
import type {Context, Response, ToolDefinition} from '../tools/ToolDefinition.js';
import type {TrafficSummary} from '../formatters/websocketFormatter.js';
import type {TraceResult} from '../trace-processing/parse.js';
import type {ActionHandler} from '../types/rpc.js';

import type {ToolContextProvider} from './ToolContextProvider.js';
import {ToolResponseAccumulator} from './ToolResponseAccumulator.js';

type LoadedHandler = ((...args: unknown[]) => Promise<unknown>) | ToolDefinition;

export class ToolAdapter {
  private contextProvider: ToolContextProvider;
  private loadedHandlers = new Map<string, LoadedHandler>();
  private trafficSummaryCache = new Map<number, TrafficSummary>();

  constructor(contextProvider: ToolContextProvider) {
    this.contextProvider = contextProvider;
  }

  /**
   * 从 ToolContextProvider 构建 defineTool 所需的 Context 对象
   */
  private buildDefineToolContext(): Context {
    const provider = this.contextProvider;
    return {
      isRunningPerformanceTrace: () => provider.isRunningPerformanceTrace(),
      setIsRunningPerformanceTrace: (x: boolean) => provider.setIsRunningPerformanceTrace(x),
      recordedTraces: () => provider.recordedTraces() as TraceResult[],
      storeTraceRecording: (result: TraceResult) => provider.storeTraceRecording(result),
      getSelectedPage: () => {
        const page = provider.getSelectedPage();
        if (!page) throw new Error('没有选中的页面');
        return page;
      },
      getDialog: () => provider.getDialog(),
      clearDialog: () => provider.clearDialog(),
      getPageByIdx: (idx) => provider.getPageByIdx(idx),
      isPageSelected: (page) => provider.getSelectedPage() === page,
      newPage: () => provider.newPage(),
      closePage: async (pageIdx: number) => {
        const page = provider.getPageByIdx(pageIdx);
        await page.close();
        await provider.syncPages();
      },
      selectPage: (page) => provider.selectPage(page),
      getSelectedFrame: () => {
        const frame = provider.getSelectedFrame();
        if (!frame) {
          const page = provider.getSelectedPage();
          return page?.mainFrame()!;
        }
        return frame;
      },
      selectFrame: (frame) => provider.setSelectedFrame(frame),
      resetSelectedFrame: () => provider.setSelectedFrame(null),
      setNetworkConditions: (conditions) => provider.setNetworkConditions(conditions),
      setCpuThrottlingRate: (rate) => provider.setCpuThrottlingRate(rate),
      saveTemporaryFile: async (_data, _mimeType) => {
        throw new Error('saveTemporaryFile not supported in worker mode');
      },
      saveFile: async (_data, _filename) => {
        throw new Error('saveFile not supported in worker mode');
      },
      waitForEventsAfterAction: async (action) => {
        await action();
      },
      waitForTextOnPage: async (_params) => {
        throw new Error('waitForTextOnPage not supported in worker mode');
      },
      getDevToolsData: () => provider.getDevToolsData(),
      resolveCdpRequestId: (cdpRequestId) => provider.resolveCdpRequestId(cdpRequestId),
      debuggerContext: provider.getDebuggerContext.bind(provider) as unknown as Context['debuggerContext'],
      getRequestInitiator: (request) => provider.getRequestInitiator(request),
      getRequestInitiatorById: (_requestId) => undefined,
      getNetworkRequestById: (reqid) => provider.getNetworkRequestById(reqid),
      getWebSocketConnections: (includePreservedData) => provider.getWebSocketConnections(includePreservedData),
      getWebSocketById: (wsid) => provider.getWebSocketConnectionById(wsid),
      getWebSocketStableId: (ws) => provider.getWebSocketStableId(ws),
      cacheTrafficSummary: (wsid, summary) => { this.trafficSummaryCache.set(wsid, summary); },
      getCachedTrafficSummary: (wsid) => this.trafficSummaryCache.get(wsid),
    };
  }

  /**
   * 动态加载 Tool handler 或 defineTool 定义
   */
  private async loadHandler(meta: ToolMeta): Promise<LoadedHandler | null> {
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
      if (typeof handler === 'function') {
        this.loadedHandlers.set(cacheKey, handler);
        return handler;
      }
      // 支持 defineTool 返回的 ToolDefinition 对象
      if (typeof handler === 'object' && handler !== null && typeof handler.handler === 'function') {
        this.loadedHandlers.set(cacheKey, handler as ToolDefinition);
        return handler as ToolDefinition;
      }
      console.warn(`[ToolAdapter] ${cacheKey} handler 不是函数也不是 ToolDefinition`);
      return null;
    } catch (err) {
      console.warn(`[ToolAdapter] 加载 ${cacheKey} 失败: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * 判断加载的 handler 是否为 defineTool 定义的 ToolDefinition
   */
  private isToolDefinition(handler: LoadedHandler): handler is ToolDefinition {
    return typeof handler === 'object' && handler !== null && typeof handler.handler === 'function';
  }

  /**
   * 将 Tool handler 包装为 Sekiro ActionHandler
   */
  wrapTool(meta: ToolMeta): ActionHandler {
    return async (rpcRequest, resolve, reject) => {
      const startTime = Date.now();
      const toolName = meta.name;

      try {
        const handler = await this.loadHandler(meta);
        if (!handler) {
          reject(`Tool handler 未找到: ${toolName}`);
          return;
        }

        const params = rpcRequest.params || {};

        // ── defineTool 模式 ──────────────────────────────────
        if (this.isToolDefinition(handler) || meta.callMode === 'defineTool') {
          if (!this.isToolDefinition(handler)) {
            reject(`Tool "${toolName}" marked as defineTool but handler is not a ToolDefinition`);
            return;
          }
          const accumulator = new ToolResponseAccumulator();
          const context = this.buildDefineToolContext();

          await handler.handler(
            {params},
            accumulator as Response,
            context,
          );

          const duration = Date.now() - startTime;
          console.log(`[Worker][ToolAdapter] action=${toolName} duration=${duration}ms status=ok mode=defineTool`);
          resolve(accumulator.toJSON());
          return;
        }

        // ── 传统函数模式 ────────────────────────────────────
        const page = this.contextProvider.getSelectedPage();
        const callMode = meta.callMode;

        let result: unknown;
        if (callMode === 'frame') {
          const frame = this.contextProvider.getSelectedFrame()
            ?? page?.mainFrame()
            ?? null;
          if (frame) {
            result = await handler(frame, params);
          } else {
            reject(`Tool "${toolName}" 需要页面上下文，但当前没有可用页面`);
            return;
          }
        } else if (callMode === 'context') {
          if (!this.contextProvider) {
            reject(`Tool "${toolName}" 需要上下文，但 contextProvider 不可用`);
            return;
          }
          result = await handler(this.contextProvider, params);
        } else {
          result = await handler(params);
        }

        const duration = Date.now() - startTime;
        console.log(`[Worker][ToolAdapter] action=${toolName} duration=${duration}ms status=ok mode=${callMode}`);

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
