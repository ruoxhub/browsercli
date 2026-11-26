/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolExecutor — 单一直线工具执行引擎（ADR-0008 / ADR-0009）
 *
 * 合并原 ToolHandlerLoader + ToolExecutionRouter + ToolExecutionPipeline：
 * 1. 从静态注册表（STATIC_TOOL_HANDLERS）O(1) 解析工具定义，消灭运行时二次 import()
 * 2. 参数校验 + 前置条件检查 + 按目标 BrowserPage 解析可选 pageId 路由
 * 3. 按 ToolConcurrency ('exclusive' | 'page' | 'none') 与目标 pageId 独立排队
 * 4. 编译期作用域分发：definePageTool 注入非空 BrowserPage，其余注入绑定目标页的 Context
 * 5. 统一 DeclarativeResponse 物化、错误包装、健康追踪与遥测记录
 */

import {zod} from '../third_party/index.js';
import {STATIC_TOOL_HANDLERS} from '../tools/generated-tools-index.js';
import {ToolPrerequisiteChecker} from '../tools/prerequisites/ToolPrerequisiteChecker.js';
import {
  validateToolArgs,
  type ValidationFailure,
} from '../tools/tool-arg-validator.js';
import {
  isPageToolDefinition,
  type AnyToolDefinition,
  type Response,
  type ToolConcurrency,
} from '../tools/ToolDefinition.js';
import type {ToolMeta} from '../tools/tools-meta.js';
import {createToolError, ErrorCodes, ToolError} from '../utils/errors.js';
import {Mutex} from '../utils/Mutex.js';

import type {BrowserPage} from './BrowserPage.js';
import type {PageHealthTracker} from './context/PageHealthTracker.js';
import type {SessionContext} from './SessionContext.js';
import type {ToolCallContextGuard} from './ToolCallContextGuard.js';
import {
  ToolResponseAccumulator,
  ToolResponseProcessor,
  ToolResultRecorder,
  ToolTelemetry,
} from './ToolResponse.js';
import {
  raceWithAbort,
  type WorkerActivityCoordinator,
  workerActivityCoordinator,
} from './WorkerActivityCoordinator.js';

function hasZodEffects(field: zod.ZodTypeAny): boolean {
  let current: zod.ZodTypeAny = field;
  while (current) {
    if (current instanceof zod.ZodEffects) return true;
    if (current instanceof zod.ZodOptional || current instanceof zod.ZodNullable) {
      current = current.unwrap();
      continue;
    }
    if (current instanceof zod.ZodDefault) {
      current = current.removeDefault();
      continue;
    }
    break;
  }
  return false;
}

async function acquireWithAbort(
  mutex: Mutex,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<Mutex['acquire']>>> {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('operation aborted');
  }
  const acquirePromise = mutex.acquire();
  if (!signal) {
    return await acquirePromise;
  }
  try {
    return await raceWithAbort(acquirePromise, signal);
  } catch (err) {
    // 若在等待锁期间被中止，锁最终获取到时必须立刻释放，防止永久死锁
    void acquirePromise.then(guard => guard.dispose()).catch(() => undefined);
    throw err;
  }
}

/**
 * 按 ToolConcurrency ('exclusive' | 'page' | 'none') 协调工具执行顺序：
 * - `'none'` 直接并发放行
 * - `'page'` 对同一 pageId 串行，不同页面可并发
 * - `'exclusive'` 等待并阻塞所有页面队列与独占队列
 */
export class ConcurrencyQueue {
  private readonly exclusiveMutex = new Mutex();
  private readonly pageMutexes = new Map<string, Mutex>();
  private activePageCount = 0;
  private pageDrainWaiters: Array<() => void> = [];

  private getPageMutex(pageKey: string): Mutex {
    let mutex = this.pageMutexes.get(pageKey);
    if (!mutex) {
      mutex = new Mutex();
      this.pageMutexes.set(pageKey, mutex);
    }
    return mutex;
  }

  async run<T>(
    concurrency: ToolConcurrency | undefined,
    pageKey: string,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!concurrency || concurrency === 'none') {
      return await raceWithAbort(fn(), signal);
    }

    if (concurrency === 'exclusive') {
      const guard = await acquireWithAbort(this.exclusiveMutex, signal);
      try {
        if (this.activePageCount > 0) {
          await raceWithAbort(
            new Promise<void>(resolve => {
              this.pageDrainWaiters.push(resolve);
            }),
            signal,
          );
        }
        const task = fn();
        void task.catch(() => undefined);
        return await raceWithAbort(task, signal);
      } finally {
        guard.dispose();
      }
    }

    const exclusiveGuard = await acquireWithAbort(this.exclusiveMutex, signal);
    exclusiveGuard.dispose();

    const pageGuard = await acquireWithAbort(
      this.getPageMutex(pageKey),
      signal,
    );
    this.activePageCount += 1;
    try {
      const task = fn();
      void task.catch(() => undefined);
      return await raceWithAbort(task, signal);
    } finally {
      this.activePageCount -= 1;
      if (this.activePageCount === 0 && this.pageDrainWaiters.length > 0) {
        const waiters = this.pageDrainWaiters.splice(0);
        for (const resolve of waiters) {
          resolve();
        }
      }
      pageGuard.dispose();
    }
  }
}

export function isAnyToolDefinition(
  value: unknown,
): value is AnyToolDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyToolDefinition).handler === 'function'
  );
}

export interface ToolExecutorOptions {
  session: SessionContext;
  processor?: ToolResponseProcessor;
  telemetry?: ToolTelemetry;
  contextGuard?: ToolCallContextGuard;
  prerequisiteChecker?: ToolPrerequisiteChecker;
  resultRecorder?: ToolResultRecorder;
  activityCoordinator?: WorkerActivityCoordinator;
  healthTracker?: PageHealthTracker;
  /** 可选自定义静态表（供单测注入 fake 工具） */
  staticHandlers?: Readonly<Record<string, AnyToolDefinition>>;
}

export class ToolExecutor {
  private readonly session: SessionContext;
  private readonly processor: ToolResponseProcessor;
  private readonly telemetry: ToolTelemetry;
  private readonly contextGuard?: ToolCallContextGuard;
  private readonly prerequisiteChecker: ToolPrerequisiteChecker;
  private readonly resultRecorder: ToolResultRecorder;
  private readonly activityCoordinator: WorkerActivityCoordinator;
  private readonly healthTracker: PageHealthTracker;
  private readonly staticHandlers: Readonly<Record<string, AnyToolDefinition>>;
  private readonly concurrencyQueue = new ConcurrencyQueue();
  private readonly dynamicFallbackCache = new Map<string, AnyToolDefinition>();

  constructor(options: ToolExecutorOptions) {
    this.session = options.session;
    this.processor = options.processor ?? new ToolResponseProcessor();
    this.telemetry = options.telemetry ?? new ToolTelemetry(options.session);
    this.contextGuard = options.contextGuard;
    this.healthTracker = options.healthTracker ?? options.session.healthTracker;
    this.prerequisiteChecker =
      options.prerequisiteChecker ??
      new ToolPrerequisiteChecker(options.session, this.healthTracker);
    this.resultRecorder = options.resultRecorder ?? new ToolResultRecorder();
    this.activityCoordinator =
      options.activityCoordinator ?? workerActivityCoordinator;
    this.staticHandlers = options.staticHandlers ?? STATIC_TOOL_HANDLERS;
  }

  async execute(
    meta: ToolMeta,
    rawParams: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return await this.activityCoordinator.runTool(async () => {
      if (!this.session.isBrowserConnected()) {
        await this.session.ensureConnectedBrowser().catch(() => undefined);
      }

      const startedAt = Date.now();
      const traceId = `tr_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const toolName = meta.name;
      let params: Record<string, unknown> | undefined;

      try {
        params = this.validateParams(toolName, rawParams);
        const tool = await this.resolveTool(toolName, meta);
        params = this.applyZodEffects(toolName, tool, params);

        // 仅页级工具支持框架级 pageId 路由；浏览器级工具（如 select_page / close_page）
        // 自行处理其 pageId 参数，不在此处预解析。
        const rawPageId = params.pageId;
        const explicitPageId =
          isPageToolDefinition(tool) &&
          (typeof rawPageId === 'string' || typeof rawPageId === 'number') &&
          String(rawPageId).trim().length > 0
            ? String(rawPageId).trim()
            : undefined;

        const targetPage = this.resolveTargetPage(
          toolName,
          tool,
          meta,
          explicitPageId,
        );

        this.prerequisiteChecker.check(
          toolName,
          meta.requirements,
          meta.prerequisites,
          targetPage,
        );

        if (
          isPageToolDefinition(tool) &&
          tool.requirePage !== false &&
          !targetPage
        ) {
          throw createToolError(
            ErrorCodes.PAGE_REQUIRED,
            '当前没有选中的页面，请先调用 new_page 或 select_page',
            {toolName},
            {
              retryable: false,
              recovery: {
                tool: 'list_pages',
                command: 'browsercli list_pages',
                reason: 'List or open a page first.',
              },
            },
          );
        }

        this.checkDialogBlock(toolName, tool, targetPage);

        const pageKey = targetPage?.id ?? this.resolveSelectedPageKey();
        const response = await this.concurrencyQueue.run(
          tool.concurrency,
          pageKey,
          async () => await this.runTool(tool, params!, toolName, targetPage),
          signal,
        );

        this.recordSuccess(
          toolName,
          params,
          response,
          startedAt,
          traceId,
          targetPage,
        );
        return response;
      } catch (error) {
        this.recordFailure(toolName, params, error, startedAt, traceId);
        throw this.wrapError(error, toolName);
      }
    }, signal);
  }

  private async resolveTool(
    toolName: string,
    meta: ToolMeta,
  ): Promise<AnyToolDefinition> {
    const cacheKey = `${meta.modulePath}:${meta.handlerName}`;
    const staticHit = this.staticHandlers[cacheKey];
    if (staticHit) {
      return staticHit;
    }

    const cached = this.dynamicFallbackCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 仅作为自定义测试夹具模块的兜底动态加载
    try {
      const modulePath = `../tools${meta.modulePath.replace(/^\./, '')}`;
      const mod = (await import(modulePath)) as Record<string, unknown>;
      const candidate = mod[meta.handlerName];
      if (isAnyToolDefinition(candidate)) {
        this.dynamicFallbackCache.set(cacheKey, candidate);
        return candidate;
      }
    } catch {
      // 落入 NOT_FOUND
    }

    throw createToolError(
      ErrorCodes.NOT_FOUND,
      `Tool handler 未找到: ${toolName}`,
      {toolName},
    );
  }

  private resolveTargetPage(
    toolName: string,
    tool: AnyToolDefinition,
    meta: ToolMeta,
    explicitPageId?: string,
  ): BrowserPage | undefined {
    if (explicitPageId) {
      if (
        meta.requirements?.browser === 'connected' &&
        !this.session.isBrowserConnected()
      ) {
        return undefined;
      }
      try {
        return this.session.resolveBrowserPage({pageId: explicitPageId});
      } catch (error) {
        throw createToolError(
          ErrorCodes.PAGE_NOT_FOUND,
          error instanceof Error ? error.message : String(error),
          {toolName, pageId: explicitPageId},
          {
            retryable: false,
            recovery: {
              tool: 'list_pages',
              command: 'browsercli list_pages',
              reason: 'List open tabs to obtain a valid pageId.',
            },
          },
        );
      }
    }
    if (isPageToolDefinition(tool)) {
      this.session.getPages();
      return this.session.getSelectedBrowserPage() ?? undefined;
    }
    return this.session.getSelectedBrowserPage() ?? undefined;
  }

  private resolveSelectedPageKey(): string {
    const selected = this.session.getSelectedBrowserPage();
    return selected?.id ?? 'default';
  }

  private checkDialogBlock(
    toolName: string,
    tool: AnyToolDefinition,
    targetPage?: BrowserPage,
  ): void {
    if (tool.blockedByDialog !== true) {
      return;
    }
    const dialog = targetPage
      ? targetPage.getDialog()
      : this.session.getDialog();
    if (dialog) {
      throw createToolError(
        ErrorCodes.PREREQUISITE,
        `Page has an open "${dialog.type()}" dialog ("${dialog.message()}"). Handle it with handle_dialog before calling "${toolName}".`,
        {toolName, dialogType: dialog.type()},
        {
          retryable: false,
          recovery: {
            tool: 'handle_dialog',
            command: 'browsercli handle_dialog --action accept',
            reason: 'Accept or dismiss the open dialog before retrying.',
          },
        },
      );
    }
  }

  private validateParams(
    toolName: string,
    rawParams: unknown,
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
    return validated.value;
  }

  /**
   * 对工具 Zod schema 中包含 transform / refine / superRefine 的字段执行 Zod 解析，
   * 确保诸如 emulate --viewport / --geolocation / --extraHttpHeaders 与 mock_network --route 等
   * 声明式转换在 CLI → ToolExecutor 链路中实际生效。
   */
  private applyZodEffects(
    toolName: string,
    tool: AnyToolDefinition,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const schema = tool.schema;
    if (!schema || typeof schema !== 'object') {
      return params;
    }
    let next: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      const field = schema[key] as zod.ZodTypeAny | undefined;
      if (!field || !hasZodEffects(field)) continue;
      const parsed = field.safeParse(value);
      if (!parsed.success) {
        const msg = parsed.error.issues.map(i => i.message).join('; ');
        throw createToolError(
          ErrorCodes.VALIDATION,
          `${toolName} 的参数 ${key} 无效：${msg}`,
          {toolName, key},
        );
      }
      next ??= {...params};
      next[key] = parsed.data;
    }
    return next ?? params;
  }

  private async runTool(
    tool: AnyToolDefinition,
    params: Record<string, unknown>,
    toolName: string,
    targetPage?: BrowserPage,
  ): Promise<unknown> {
    const accumulator = new ToolResponseAccumulator();
    const context = this.session.toToolContext(targetPage);

    try {
      if (isPageToolDefinition(tool)) {
        const page =
          targetPage ??
          (tool.requirePage === false
            ? undefined
            : this.session.resolveBrowserPage({fallbackToSelected: true}));
        await tool.handler(
          {params: params as never, page},
          accumulator as Response,
          context,
        );
      } else {
        await tool.handler(
          {params: params as never},
          accumulator as Response,
          context,
        );
      }

      await accumulator.materialize(this.session, targetPage);
    } finally {
      accumulator.cleanupListeners();
    }

    const rawResult = accumulator.toJSON();
    const normalized = this.processor.normalize(rawResult);
    this.contextGuard?.recordCall(toolName);
    const targetMeta = targetPage
      ? this.session.getContextMetaForPage(targetPage)
      : undefined;
    const enriched =
      this.contextGuard?.enrichResponse(toolName, normalized, targetMeta) ??
      normalized;
    return this.processor.process(enriched, toolName);
  }

  private recordSuccess(
    toolName: string,
    params: Record<string, unknown> | undefined,
    response: unknown,
    startedAt: number,
    traceId: string,
    targetPage?: BrowserPage,
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
    const bp = targetPage ?? this.session.getSelectedBrowserPage();
    bp?.recordHealthy();
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
