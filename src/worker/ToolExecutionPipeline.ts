/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from 'patchright';

import {ToolPrerequisiteChecker} from '../tools/prerequisites/ToolPrerequisiteChecker.js';
import {
  validateToolArgs,
  type ValidationFailure,
} from '../tools/tool-arg-validator.js';
import type {Response, ToolDefinition} from '../tools/ToolDefinition.js';
import type {ToolMeta} from '../tools/tools-meta.js';
import {createToolError, ErrorCodes, ToolError} from '../utils/errors.js';

import {
  globalPageHealthTracker,
  type PageHealthTracker,
} from './context/PageHealthTracker.js';
import {wrapFrameWithTimeout} from './timeoutUtils.js';
import type {ToolCallContextGuard} from './ToolCallContextGuard.js';
import type {
  DefineToolContextFactory,
  ToolContextProvider,
} from './ToolContext.js';
import {ToolResponseAccumulator, ToolResultRecorder} from './ToolResponse.js';
import type {ToolResponseProcessor, ToolTelemetry} from './ToolResponse.js';
import {
  type WorkerActivityCoordinator,
  workerActivityCoordinator,
} from './WorkerActivityCoordinator.js';

export {wrapFrameWithTimeout, FRAME_EVALUATE_TIMEOUT} from './timeoutUtils.js';

/**
 * 工具执行管线。负责参数校验、上下文注入、执行、响应构建的完整链路。
 *
 * @see {@link src/worker/ToolAdapter.ts} — 适配层，调用 Pipeline 执行
 * @see {@link src/worker/ToolContext.ts} — 上下文提供者注入
 * @see {@link src/worker/ToolResponse.ts} — 响应构建
 */

export type LoadedHandler =
  | ((...args: unknown[]) => Promise<unknown>)
  | ToolDefinition;

export function isToolDefinition(value: unknown): value is ToolDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ToolDefinition).handler === 'function'
  );
}

export class ToolHandlerLoader {
  private readonly loadedHandlers = new Map<string, LoadedHandler>();

  async load(meta: ToolMeta): Promise<LoadedHandler | null> {
    const cacheKey = `${meta.modulePath}:${meta.handlerName}`;
    const cached = this.loadedHandlers.get(cacheKey);
    if (cached) return cached;

    try {
      const modulePath = `../tools${meta.modulePath.replace(/^\./, '')}`;
      const module = await import(modulePath);
      const handler = module[meta.handlerName];

      if (typeof handler === 'function' || isToolDefinition(handler)) {
        this.loadedHandlers.set(cacheKey, handler);
        return handler;
      }

      console.warn(
        `[ToolHandlerLoader] ${cacheKey} handler 不是函数也不是 ToolDefinition`,
      );
      return null;
    } catch (error) {
      console.warn(
        `[ToolHandlerLoader] 加载 ${cacheKey} 失败: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}

export class ToolExecutionRouter {
  constructor(
    private readonly contextProvider: ToolContextProvider,
    private readonly defineToolContextFactory: DefineToolContextFactory,
    private readonly pageHealthTracker: PageHealthTracker = globalPageHealthTracker,
  ) {}

  async execute(
    meta: ToolMeta,
    handler: LoadedHandler,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (isToolDefinition(handler) || meta.callMode === 'defineTool') {
      if (!isToolDefinition(handler)) {
        throw createToolError(
          ErrorCodes.RUNTIME,
          `Tool "${meta.name}" marked as defineTool but handler is not a ToolDefinition`,
          {toolName: meta.name},
        );
      }

      const accumulator = new ToolResponseAccumulator();
      await handler.handler(
        {params},
        accumulator as Response,
        this.defineToolContextFactory.create(),
      );
      return accumulator.toJSON();
    }

    if (meta.callMode === ('frame' as ToolMeta['callMode'])) {
      const frame =
        this.contextProvider.getSelectedFrame() ??
        this.contextProvider.getSelectedPage()?.mainFrame() ??
        null;
      if (!frame) {
        throw createToolError(
          ErrorCodes.CONNECTION,
          `Tool "${meta.name}" 需要页面上下文，但当前没有可用页面`,
          {toolName: meta.name},
        );
      }
      return handler(
        wrapFrameWithTimeout(frame, {
          onTimeout: () => this.recordFrameTimeout(frame),
        }),
        params,
      );
    }

    if (meta.callMode === ('context' as ToolMeta['callMode'])) {
      return handler(this.contextProvider, params);
    }

    return handler(params);
  }

  /**
   * frame.evaluate 超时时记录页面健康状态，供快速失败守卫使用。
   */
  private recordFrameTimeout(frame: Frame): void {
    try {
      const page = typeof frame.page === 'function' ? frame.page() : null;
      if (!page) return;
      this.pageHealthTracker.recordTimeout(
        this.contextProvider.getPageId(page),
      );
    } catch {
      // 拿不到 pageId（如页面已销毁）时跳过健康记录
    }
  }
}

export class ToolExecutionPipeline {
  private readonly prerequisiteChecker?: ToolPrerequisiteChecker;

  constructor(
    private readonly loader: ToolHandlerLoader,
    private readonly router: ToolExecutionRouter,
    private readonly processor: ToolResponseProcessor,
    private readonly telemetry: ToolTelemetry,
    private readonly contextGuard?: ToolCallContextGuard,
    prerequisiteChecker?: ToolPrerequisiteChecker,
    private readonly resultRecorder = new ToolResultRecorder(),
    private readonly activityCoordinator: WorkerActivityCoordinator = workerActivityCoordinator,
    private readonly pageHealthTracker: PageHealthTracker = globalPageHealthTracker,
    private readonly contextProvider?: ToolContextProvider,
  ) {
    this.prerequisiteChecker =
      prerequisiteChecker ??
      (contextProvider
        ? new ToolPrerequisiteChecker(contextProvider, this.pageHealthTracker)
        : undefined);
  }

  async execute(
    meta: ToolMeta,
    rawParams: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return await this.activityCoordinator.runTool(async () => {
      if (
        this.contextProvider &&
        typeof this.contextProvider.isBrowserConnected === 'function' &&
        !this.contextProvider.isBrowserConnected()
      ) {
        if (typeof this.contextProvider.ensureConnectedBrowser === 'function') {
          await this.contextProvider
            .ensureConnectedBrowser()
            .catch(() => undefined);
        }
      }
      const startedAt = Date.now();
      const traceId = this.generateTraceId(startedAt);
      const toolName = meta.name;
      let params: Record<string, unknown> | undefined;

      try {
        params = this.validateAndPrepare(toolName, rawParams, meta);
        const handler = await this.loadHandler(toolName, meta);
        const response = await this.processRequest(
          meta,
          handler,
          params,
          toolName,
        );

        this.recordSuccess(toolName, params, response, startedAt, traceId);
        return response;
      } catch (error) {
        this.recordFailure(toolName, params, error, startedAt, traceId);
        throw this.wrapError(error, toolName);
      }
    }, signal);
  }

  private generateTraceId(startedAt: number): string {
    return `tr_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private validateAndPrepare(
    toolName: string,
    rawParams: unknown,
    meta: ToolMeta,
  ): Record<string, unknown> {
    const validated = validateToolArgs(
      toolName,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    if (!validated.ok) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        (validated as ValidationFailure).error,
        {toolName},
      );
    }
    this.prerequisiteChecker?.check(
      toolName,
      meta.requirements,
      meta.prerequisites,
    );
    return validated.value;
  }

  private async loadHandler(
    toolName: string,
    meta: ToolMeta,
  ): Promise<LoadedHandler> {
    const handler = await this.loader.load(meta);
    if (!handler) {
      throw createToolError(
        ErrorCodes.NOT_FOUND,
        `Tool handler 未找到: ${toolName}`,
        {toolName},
      );
    }
    return handler;
  }

  private async processRequest(
    meta: ToolMeta,
    handler: LoadedHandler,
    params: Record<string, unknown>,
    toolName: string,
  ): Promise<unknown> {
    const rawResult = await this.router.execute(meta, handler, params);
    const normalized = this.processor.normalize(rawResult);
    this.contextGuard?.recordCall(toolName);
    const enriched =
      this.contextGuard?.enrichResponse(toolName, normalized) ?? normalized;
    return this.processor.process(enriched);
  }

  private recordSuccess(
    toolName: string,
    params: Record<string, unknown> | undefined,
    response: unknown,
    startedAt: number,
    traceId: string,
  ): void {
    const durationMs = Date.now() - startedAt;
    this.telemetry.success(
      toolName,
      params ?? {},
      response,
      durationMs,
      traceId,
    );
    this.resultRecorder.record({
      toolName,
      traceId,
      success: true,
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      input: params,
      request: params,
      response,
    });
    this.recordPageHealthy();
  }

  private recordPageHealthy(): void {
    if (!this.contextProvider) return;
    try {
      const page = this.contextProvider.getSelectedPage();
      if (!page) return;
      this.pageHealthTracker.recordSuccess(
        this.contextProvider.getPageId(page),
      );
    } catch {
      // 拿不到 pageId 时跳过健康记录
    }
  }

  private recordFailure(
    toolName: string,
    params: Record<string, unknown> | undefined,
    error: unknown,
    startedAt: number,
    traceId: string,
  ): void {
    const toolError = this.wrapError(error, toolName);
    const durationMs = Date.now() - startedAt;
    this.telemetry.failure(toolName, toolError, durationMs, traceId);
    this.resultRecorder.record({
      toolName,
      traceId,
      success: false,
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      input: params,
      request: params,
      error: {code: toolError.code, message: toolError.message},
    });
  }

  private wrapError(error: unknown, toolName: string): ToolError {
    return error instanceof ToolError
      ? error
      : createToolError(
          ErrorCodes.RUNTIME,
          error instanceof Error ? error.message : String(error),
          {toolName},
        );
  }
}
