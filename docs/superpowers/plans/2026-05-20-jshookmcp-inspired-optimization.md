# JSReverser-CLI jshookmcp-Inspired Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 jshookmcp 的服务内核、执行管道、懒加载、可观测性与大响应处理思路，按 JSReverser-CLI 现有架构渐进落地，降低工具执行复杂度并提升扩展性。

**Architecture:** 保留现有 `ToolDefinition`、`ToolContextProvider`、manifest 与 worker RPC 入口，先在 `src/worker/` 内部拆出执行管道，再把横切逻辑沉淀到 `src/utils/`。后续通过 profile-aware registry 和 lazy runtime services 减少启动成本，避免一次性大重构破坏工具兼容性。

**Tech Stack:** TypeScript ESM, Node `node:test`, SWC build, Zod, existing `EventBus`, `DetailedDataManager`, `TokenBudgetManager`, `ToolContextProvider`.

---

## Evidence Summary

- `src/worker/ToolAdapter.ts` 当前同时负责 handler 加载、参数校验、上下文构建、三类调用模式分发、响应累积、日志、Token 记录、事件发送和错误归一。
- `src/runtime.ts` 当前在首次 `getRuntime()` 时 eager 创建浏览器、收集器、分析器、LLM、WASM、缓存与事件总线等服务。
- `src/utils/EventBus.ts` 支持类型化事件与 Zod 校验，但 `emit()` 对异步监听器采用 fire-and-forget。
- `src/utils/detailedDataManager.ts` 已有大数据摘要和 `detailId` 能力，但工具执行出口只做大响应告警，未统一 offload。
- `package.json` 已有 build/test/coverage 脚本，但 build 命令较长，核心覆盖率范围没有覆盖新的执行管道。

## File Structure

### New Files

- `src/worker/ToolHandlerLoader.ts`  
  负责按 `ToolMeta` 动态加载 handler，并缓存 `modulePath:handlerName`。

- `src/worker/DefineToolContextFactory.ts`  
  负责从 `ToolContextProvider` 构建 `ToolDefinition.Context`，从 `ToolAdapter` 中移出上下文映射。

- `src/worker/ToolExecutionRouter.ts`  
  负责 `defineTool`、`frame`、`context`、默认函数四种调用模式分发。

- `src/worker/ToolExecutionPipeline.ts`  
  负责 validate -> load -> execute -> response normalize -> offload -> telemetry -> error normalize 的顺序编排。

- `src/worker/ToolTelemetry.ts`  
  负责成功/失败事件、TokenBudget 记录、结构化日志。

- `src/worker/ToolResponseOffloader.ts`  
  负责统一调用 `DetailedDataManager.smartHandle()`，替换仅告警的大响应处理。

- `src/runtime/RuntimeServices.ts`  
  负责 LLM、Analyzer、Deobfuscator、WASM 等服务的懒实例化。

- `src/tools/registry/ToolRegistry.ts`  
  负责 profile-aware manifest 聚合、工具查询和依赖元数据读取。

- `tests/unit/worker/ToolExecutionPipeline.test.ts`  
  覆盖执行管道成功、校验失败、handler 缺失、错误归一、大响应 offload。

- `tests/unit/worker/ToolResponseOffloader.test.ts`  
  覆盖阈值以内直返、阈值以上摘要化。

- `tests/unit/runtime/RuntimeServices.test.ts`  
  覆盖懒实例化和重复 getter 返回同一实例。

- `tests/unit/tools/ToolRegistry.profile.test.ts`  
  覆盖 profile 过滤、handler 元数据读取、工具名去重。

### Modified Files

- `src/worker/ToolAdapter.ts`  
  收缩为 RPC adapter：初始化 pipeline、把 `ActionHandler` 请求转交给 pipeline。

- `src/worker/ToolContextProvider.ts`  
  如需要，暴露 `DefineToolContextFactory` 所需的稳定访问方法；避免新增业务逻辑。

- `src/runtime.ts`  
  用 `RuntimeServices` 替换 eager 创建的 LLM/Analyzer/Deobfuscator/WASM 服务。

- `src/utils/EventBus.ts`  
  新增 `emitAsync()`，保留现有 `emit()` 兼容旧调用。

- `src/utils/logger.ts`  
  支持结构化字段日志，保留原字符串日志签名。

- `src/tools/manifest.ts`  
  扩展 `DomainManifest` 类型，增加可选 `profile`、`dependencies`。

- `src/tools/generated-tools-index.ts`  
  继续由生成脚本维护；实现阶段不可手改。

- `scripts/generate-tools-index.ts`  
  增强生成输出，使 manifest profile/dependencies 进入 registry 输入。

- `package.json`  
  拆分 build 子脚本，补充 pipeline/registry 相关测试脚本或 coverage include。

---

## Implementation Notes

- 不新增运行时依赖。先用现有 Zod、node:test、logger、EventBus、DetailedDataManager。
- 每次改动前，如修改函数/类符号，按仓库 GitNexus 规则先做 impact analysis；文档任务不需要。
- 每个任务完成后至少运行对应单测；阶段完成后运行 `npm run typecheck`、`npm run check-format`、`npm run test:unit`。
- 任何提交信息使用 Lore Commit Protocol trailer，示例见各任务。

---

### Task 1: Lock Current ToolAdapter Behavior

**Files:**
- Modify: `tests/unit/worker/ToolAdapter.test.ts`
- Read: `src/worker/ToolAdapter.ts`
- Read: `src/worker/ToolResponseAccumulator.ts`

- [ ] **Step 1: Add regression tests for call modes**

在 `tests/unit/worker/ToolAdapter.test.ts` 中补齐四类行为：

```ts
test('wrapTool executes default function handlers with validated params', async () => {
  // Arrange a ToolMeta with callMode omitted/default.
  // Stub loader-facing module export through existing test pattern in this file.
  // Assert resolve receives ToolResponseAccumulator JSON shape.
});

test('wrapTool executes context handlers with ToolContextProvider', async () => {
  // Arrange callMode: 'context'.
  // Assert handler receives the same provider instance used by ToolAdapter.
});

test('wrapTool executes frame handlers with selected frame', async () => {
  // Arrange callMode: 'frame' and provider.getSelectedFrame().
  // Assert handler receives a frame proxy with evaluate timeout wrapping.
});

test('wrapTool executes defineTool handlers with accumulated response', async () => {
  // Arrange callMode: 'defineTool'.
  // Assert handler receives {params}, Response accumulator, and Context facade.
});
```

- [ ] **Step 2: Add regression tests for error and telemetry behavior**

```ts
test('wrapTool rejects validation errors as ToolError VALIDATION', async () => {
  // Invalid args should reject with ErrorCodes.VALIDATION.
});

test('wrapTool rejects missing handlers as ToolError NOT_FOUND', async () => {
  // Missing export should reject with ErrorCodes.NOT_FOUND.
});

test('wrapTool emits tool:error for thrown errors', async () => {
  // Subscribe to provider.eventBus and assert payload includes name/code/message.
});
```

- [ ] **Step 3: Run focused tests and confirm current baseline**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/ToolAdapter.test.js
```

Expected: PASS after tests are written against current behavior. If a test exposes a real current bug, mark it with a narrow failing assertion and fix in the implementation task that owns the behavior.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/worker/ToolAdapter.test.ts
git commit -m "Protect tool adapter execution behavior

The execution adapter is about to be split into smaller pipeline units,
so the existing call modes and error surfaces need explicit regression
coverage before moving logic.

Constraint: Preserve worker RPC response shape for existing clients
Confidence: high
Scope-risk: narrow
Tested: ToolAdapter focused unit test
Not-tested: Full worker RPC integration"
```

---

### Task 2: Extract Handler Loader and DefineTool Context Factory

**Files:**
- Create: `src/worker/ToolHandlerLoader.ts`
- Create: `src/worker/DefineToolContextFactory.ts`
- Modify: `src/worker/ToolAdapter.ts`
- Modify: `tests/unit/worker/ToolAdapter.test.ts`

- [ ] **Step 1: Run GitNexus impact analysis**

Run the required impact analysis before editing `ToolAdapter`:

```bash
npx gitnexus impact ToolAdapter --direction upstream
```

Expected: report direct callers/importers. If risk is HIGH or CRITICAL, pause implementation and report the blast radius before editing.

- [ ] **Step 2: Create `ToolHandlerLoader.ts`**

```ts
import type {ToolMeta} from '../cli/tools-meta.js';
import type {ToolDefinition} from '../tools/ToolDefinition.js';

export type LoadedHandler =
  | ((...args: unknown[]) => Promise<unknown>)
  | ToolDefinition;

export class ToolHandlerLoader {
  private readonly loadedHandlers = new Map<string, LoadedHandler>();

  async load(meta: ToolMeta): Promise<LoadedHandler | null> {
    const cacheKey = `${meta.modulePath}:${meta.handlerName}`;
    const cached = this.loadedHandlers.get(cacheKey);
    if (cached) return cached;

    const modulePath = `../tools${meta.modulePath.replace(/^\./, '')}`;
    const module = await import(modulePath);
    const handler = module[meta.handlerName];

    if (typeof handler === 'function' || this.isToolDefinition(handler)) {
      this.loadedHandlers.set(cacheKey, handler);
      return handler;
    }

    return null;
  }

  private isToolDefinition(value: unknown): value is ToolDefinition {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as ToolDefinition).handler === 'function'
    );
  }
}
```

- [ ] **Step 3: Create `DefineToolContextFactory.ts`**

Move the current `buildDefineToolContext()` body from `ToolAdapter` into:

```ts
import type {TrafficSummary} from '../formatters/websocketFormatter.js';
import type {TraceResult} from '../trace-processing/parse.js';
import type {Context} from '../tools/ToolDefinition.js';

import type {ToolContextProvider} from './ToolContextProvider.js';
import {wrapFrameWithTimeout} from './ToolExecutionRouter.js';

export class DefineToolContextFactory {
  private readonly trafficSummaryCache = new Map<number, TrafficSummary>();

  constructor(private readonly provider: ToolContextProvider) {}

  create(): Context {
    const provider = this.provider;

    return {
      isRunningPerformanceTrace: () => provider.isRunningPerformanceTrace(),
      setIsRunningPerformanceTrace: (x: boolean) =>
        provider.setIsRunningPerformanceTrace(x),
      recordedTraces: () => provider.recordedTraces() as TraceResult[],
      storeTraceRecording: (result: TraceResult) =>
        provider.storeTraceRecording(result),
      getSelectedPage: () => {
        const page = provider.getSelectedPage();
        if (!page) throw new Error('没有选中的页面');
        return page;
      },
      getDialog: () => provider.getDialog(),
      clearDialog: () => provider.clearDialog(),
      getPageByIdx: idx => provider.getPageByIdx(idx),
      isPageSelected: page => provider.getSelectedPage() === page,
      newPage: () => provider.newPage(),
      closePage: async pageIdx => {
        const page = provider.getPageByIdx(pageIdx);
        await page.close();
        await provider.syncPages();
      },
      selectPage: page => provider.selectPage(page),
      bringPageToFront: page => provider.bringPageToFront(page),
      syncPageContext: page => provider.syncPageContext(page),
      getPages: () => provider.getPages(),
      getSelectedFrame: () => {
        const frame =
          provider.getSelectedFrame() ?? provider.getSelectedPage()?.mainFrame();
        if (!frame) throw new Error('没有可用的 Frame，可能页面未选中或已关闭');
        return wrapFrameWithTimeout(frame);
      },
      selectFrame: frame => provider.setSelectedFrame(frame),
      resetSelectedFrame: () => provider.setSelectedFrame(null),
      setNetworkConditions: conditions => provider.setNetworkConditions(conditions),
      setCpuThrottlingRate: rate => provider.setCpuThrottlingRate(rate),
      saveTemporaryFile: async () => {
        throw new Error('saveTemporaryFile not supported in worker mode');
      },
      saveFile: async () => {
        throw new Error('saveFile not supported in worker mode');
      },
      waitForEventsAfterAction: async action => {
        await action();
      },
      waitForTextOnPage: async () => {
        throw new Error('waitForTextOnPage not supported in worker mode');
      },
      getDevToolsData: () => provider.getDevToolsData(),
      resolveCdpRequestId: cdpRequestId => provider.resolveCdpRequestId(cdpRequestId),
      getDebuggerContext: () => provider.getDebuggerContext(),
      getRequestInitiator: request => provider.getRequestInitiator(request),
      getRequestInitiatorById: () => undefined,
      getNetworkRequestById: reqid => provider.getNetworkRequestById(reqid),
      getWebSocketConnections: includePreservedData =>
        provider.getWebSocketConnections(includePreservedData),
      getWebSocketById: wsid => provider.getWebSocketConnectionById(wsid),
      getWebSocketStableId: ws => provider.getWebSocketStableId(ws),
      cacheTrafficSummary: (wsid, summary) => {
        this.trafficSummaryCache.set(wsid, summary);
      },
      getCachedTrafficSummary: wsid => this.trafficSummaryCache.get(wsid),
    };
  }
}
```

- [ ] **Step 4: Modify `ToolAdapter.ts` to use the new classes**

Remove `loadedHandlers`, `trafficSummaryCache`, `loadHandler()`, and `buildDefineToolContext()` from `ToolAdapter`. Inject:

```ts
private readonly loader: ToolHandlerLoader;
private readonly defineToolContextFactory: DefineToolContextFactory;

constructor(contextProvider: ToolContextProvider) {
  this.contextProvider = contextProvider;
  this.loader = new ToolHandlerLoader();
  this.defineToolContextFactory = new DefineToolContextFactory(contextProvider);
}
```

Replace:

```ts
const handler = await this.loadHandler(meta);
const context = this.buildDefineToolContext();
```

with:

```ts
const handler = await this.loader.load(meta);
const context = this.defineToolContextFactory.create();
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/ToolAdapter.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker/ToolAdapter.ts src/worker/ToolHandlerLoader.ts src/worker/DefineToolContextFactory.ts tests/unit/worker/ToolAdapter.test.ts
git commit -m "Separate tool loading from worker adapter

ToolAdapter mixed dynamic import caching and defineTool context assembly
with RPC request handling. Moving those responsibilities into focused
classes keeps the worker entry compatible while making the execution
pipeline testable in smaller pieces.

Constraint: Keep existing ToolAdapter public constructor and registerAll behavior
Rejected: Replace ToolAdapter in one large rewrite | too much behavioral risk
Confidence: high
Scope-risk: moderate
Tested: typecheck, build, ToolAdapter focused unit test"
```

---

### Task 3: Introduce ToolExecutionRouter

**Files:**
- Create: `src/worker/ToolExecutionRouter.ts`
- Modify: `src/worker/ToolAdapter.ts`
- Modify: `tests/unit/worker/ToolAdapter.test.ts`

- [ ] **Step 1: Create router and frame timeout helper**

```ts
import type {Frame} from 'patchright';

import type {ToolMeta} from '../cli/tools-meta.js';
import type {Response, ToolDefinition} from '../tools/ToolDefinition.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import type {LoadedHandler} from './ToolHandlerLoader.js';
import type {ToolContextProvider} from './ToolContextProvider.js';
import {ToolResponseAccumulator} from './ToolResponseAccumulator.js';
import type {DefineToolContextFactory} from './DefineToolContextFactory.js';

const FRAME_EVALUATE_TIMEOUT = 10_000;

export function wrapFrameWithTimeout(
  frame: Frame,
  timeoutMs: number = FRAME_EVALUATE_TIMEOUT,
): Frame {
  return new Proxy(frame, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'evaluate') {
        return function evaluateWithTimeout(this: unknown, ...args: unknown[]) {
          const evalPromise = (value as Function).apply(target, args);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`frame.evaluate() 超时 (${timeoutMs}ms)，可能调试器已暂停`),
                ),
              timeoutMs,
            ),
          );
          return Promise.race([evalPromise, timeoutPromise]);
        };
      }
      if (typeof value === 'function') return value.bind(target);
      return value;
    },
  });
}

export class ToolExecutionRouter {
  constructor(
    private readonly contextProvider: ToolContextProvider,
    private readonly defineToolContextFactory: DefineToolContextFactory,
  ) {}

  async execute(
    meta: ToolMeta,
    handler: LoadedHandler,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.isToolDefinition(handler) || meta.callMode === 'defineTool') {
      if (!this.isToolDefinition(handler)) {
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

    if (meta.callMode === 'frame') {
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
      return handler(wrapFrameWithTimeout(frame), params);
    }

    if (meta.callMode === 'context') {
      return handler(this.contextProvider, params);
    }

    return handler(params);
  }

  private isToolDefinition(handler: LoadedHandler): handler is ToolDefinition {
    return (
      typeof handler === 'object' &&
      handler !== null &&
      typeof handler.handler === 'function'
    );
  }
}
```

- [ ] **Step 2: Replace call-mode branching in `ToolAdapter`**

In `ToolAdapter.wrapTool()`, replace the defineTool/frame/context/default branch with:

```ts
const result = await this.router.execute(meta, handler, safeParams);
const responsePayload = this.normalizeResponse(result);
```

Keep `normalizeResponse()` local for now:

```ts
private normalizeResponse(result: unknown): unknown {
  if (this.isToolDefinitionResponse(result)) return result;

  const accumulator = new ToolResponseAccumulator();
  if (typeof result === 'object' && result !== null) {
    accumulator.setStructuredContent(result);
  } else if (typeof result === 'string') {
    accumulator.appendResponseLine(result);
  } else {
    accumulator.setStructuredContent(result);
  }
  return accumulator.toJSON();
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/ToolAdapter.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/worker/ToolAdapter.ts src/worker/ToolExecutionRouter.ts tests/unit/worker/ToolAdapter.test.ts
git commit -m "Route tool call modes through a dedicated executor

The adapter no longer needs to own defineTool, frame, context, and
default function dispatch. A dedicated router keeps call-mode behavior
centralized and prepares the next pipeline extraction.

Constraint: Preserve existing response accumulator shape
Confidence: high
Scope-risk: moderate
Tested: typecheck, build, ToolAdapter focused unit test"
```

---

### Task 4: Add ToolExecutionPipeline, Telemetry, and Response Offloader

**Files:**
- Create: `src/worker/ToolExecutionPipeline.ts`
- Create: `src/worker/ToolTelemetry.ts`
- Create: `src/worker/ToolResponseOffloader.ts`
- Create: `tests/unit/worker/ToolExecutionPipeline.test.ts`
- Create: `tests/unit/worker/ToolResponseOffloader.test.ts`
- Modify: `src/worker/ToolAdapter.ts`

- [ ] **Step 1: Create `ToolResponseOffloader.ts`**

```ts
import {DetailedDataManager} from '../utils/detailedDataManager.js';

export class ToolResponseOffloader {
  constructor(
    private readonly manager = DetailedDataManager.getInstance(),
    private readonly thresholdBytes = 512 * 1024,
  ) {}

  handle(response: unknown): unknown {
    return this.manager.smartHandle(response, this.thresholdBytes);
  }
}
```

- [ ] **Step 2: Create `ToolTelemetry.ts`**

```ts
import type {ToolContextProvider} from './ToolContextProvider.js';
import {TokenBudgetManager} from '../utils/TokenBudgetManager.js';
import {logger} from '../utils/logger.js';
import type {ToolError} from '../utils/errors.js';

export class ToolTelemetry {
  constructor(private readonly contextProvider: ToolContextProvider) {}

  success(
    toolName: string,
    request: Record<string, unknown>,
    response: unknown,
    durationMs: number,
  ): void {
    TokenBudgetManager.getInstance().recordToolCall(toolName, request, response);
    this.contextProvider.eventBus.emit('tool:called', {
      name: toolName,
      durationMs,
      success: true,
    });
    logger.info('tool.completed', {toolName, durationMs});
  }

  failure(toolName: string, error: ToolError, durationMs: number): void {
    this.contextProvider.eventBus.emit('tool:error', {
      name: toolName,
      code: error.code,
      message: error.message,
    });
    logger.warn('tool.failed', {toolName, durationMs, code: error.code});
  }
}
```

- [ ] **Step 3: Create `ToolExecutionPipeline.ts`**

```ts
import type {ToolMeta} from '../cli/tools-meta.js';
import {validateToolArgs} from '../cli/tool-arg-validator.js';
import {createToolError, ErrorCodes, ToolError} from '../utils/errors.js';

import {ToolHandlerLoader} from './ToolHandlerLoader.js';
import {ToolExecutionRouter} from './ToolExecutionRouter.js';
import {ToolResponseAccumulator} from './ToolResponseAccumulator.js';
import {ToolResponseOffloader} from './ToolResponseOffloader.js';
import {ToolTelemetry} from './ToolTelemetry.js';

export class ToolExecutionPipeline {
  constructor(
    private readonly loader: ToolHandlerLoader,
    private readonly router: ToolExecutionRouter,
    private readonly offloader: ToolResponseOffloader,
    private readonly telemetry: ToolTelemetry,
  ) {}

  async execute(meta: ToolMeta, rawParams: unknown): Promise<unknown> {
    const startedAt = Date.now();
    const toolName = meta.name;

    try {
      const validated = validateToolArgs(
        toolName,
        (rawParams ?? {}) as Record<string, unknown>,
      );
      if (!validated.ok) {
        throw createToolError(
          ErrorCodes.VALIDATION,
          (validated as {ok: false; error: string}).error,
          {toolName},
        );
      }

      const params = (validated as {ok: true; value: Record<string, unknown>}).value;
      const handler = await this.loader.load(meta);
      if (!handler) {
        throw createToolError(ErrorCodes.NOT_FOUND, `Tool handler 未找到: ${toolName}`, {
          toolName,
        });
      }

      const rawResult = await this.router.execute(meta, handler, params);
      const response = this.offloader.handle(this.normalizeResponse(rawResult));
      this.telemetry.success(toolName, params, response, Date.now() - startedAt);
      return response;
    } catch (error) {
      const toolError =
        error instanceof ToolError
          ? error
          : createToolError(ErrorCodes.RUNTIME, error instanceof Error ? error.message : String(error), {
              toolName,
            });
      this.telemetry.failure(toolName, toolError, Date.now() - startedAt);
      throw toolError;
    }
  }

  private normalizeResponse(result: unknown): unknown {
    if (
      typeof result === 'object' &&
      result !== null &&
      ('content' in result || 'structuredContent' in result)
    ) {
      return result;
    }

    const accumulator = new ToolResponseAccumulator();
    if (typeof result === 'object' && result !== null) {
      accumulator.setStructuredContent(result);
    } else if (typeof result === 'string') {
      accumulator.appendResponseLine(result);
    } else {
      accumulator.setStructuredContent(result);
    }
    return accumulator.toJSON();
  }
}
```

- [ ] **Step 4: Shrink `ToolAdapter.wrapTool()`**

Replace the body with:

```ts
wrapTool(meta: ToolMeta): ActionHandler {
  return async (rpcRequest, resolve, reject) => {
    try {
      resolve(await this.pipeline.execute(meta, rpcRequest.params || {}));
    } catch (error) {
      reject(error);
    }
  };
}
```

- [ ] **Step 5: Add pipeline tests**

`tests/unit/worker/ToolExecutionPipeline.test.ts` should cover:

```ts
test('execute returns normalized response for successful function tool', async () => {});
test('execute throws VALIDATION when args are invalid', async () => {});
test('execute throws NOT_FOUND when loader returns null', async () => {});
test('execute normalizes unknown thrown errors into RUNTIME ToolError', async () => {});
test('execute passes large normalized responses through ToolResponseOffloader', async () => {});
```

- [ ] **Step 6: Add offloader tests**

`tests/unit/worker/ToolResponseOffloader.test.ts` should cover:

```ts
test('handle returns small response unchanged', () => {});
test('handle returns detailed-data summary for large response', () => {});
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/ToolAdapter.test.js build/tests/unit/worker/ToolExecutionPipeline.test.js build/tests/unit/worker/ToolResponseOffloader.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/worker/ToolAdapter.ts src/worker/ToolExecutionPipeline.ts src/worker/ToolTelemetry.ts src/worker/ToolResponseOffloader.ts tests/unit/worker/ToolExecutionPipeline.test.ts tests/unit/worker/ToolResponseOffloader.test.ts tests/unit/worker/ToolAdapter.test.ts
git commit -m "Introduce a worker tool execution pipeline

Worker tool calls now pass through an explicit pipeline for validation,
dispatch, response normalization, offloading, telemetry, and error
normalization. This mirrors the jshookmcp execution-pipeline shape
without changing the external RPC adapter contract.

Constraint: No new runtime dependencies
Rejected: Full server-kernel rewrite | too large for one safe migration
Confidence: medium
Scope-risk: moderate
Tested: typecheck, build, worker pipeline unit tests"
```

---

### Task 5: Add Async Event Emission and Structured Logger Fields

**Files:**
- Modify: `src/utils/EventBus.ts`
- Modify: `src/utils/logger.ts`
- Modify: `src/worker/ToolTelemetry.ts`
- Modify: `tests/unit/utils/EventBus.test.ts`
- Modify: `tests/unit/logger/root-logger.test.ts`

- [ ] **Step 1: Add `emitAsync()` to EventBus**

Keep `emit()` unchanged for compatibility. Add:

```ts
async emitAsync<K extends keyof TMap>(
  event: K,
  payload: TMap[K],
): Promise<void> {
  const validatedPayload = this.validatePayload(event, payload);
  const handlers = [...(this.handlers.get(event) ?? [])];
  const results = await Promise.allSettled(
    handlers.map(handler => handler(validatedPayload)),
  );

  const rejected = results.find(result => result.status === 'rejected');
  if (rejected?.status === 'rejected') {
    throw rejected.reason;
  }
}
```

- [ ] **Step 2: Add logger object fields support**

Change logger methods to accept either existing variadic args or a fields object:

```ts
private formatMessage(
  level: LogLevel,
  message: string,
  ...args: unknown[]
): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const formattedArgs = args.length > 0 ? ' ' + safeStringify(args) : '';
  return `${prefix} ${message}${formattedArgs}`;
}
```

This signature already accepts fields. Add tests that `logger.info('tool.completed', {toolName: 'x'})` writes serialized fields.

- [ ] **Step 3: Keep telemetry synchronous unless async result is needed**

Do not convert all telemetry to `await emitAsync()` yet. Use:

```ts
this.contextProvider.eventBus.emit('tool:called', payload);
```

Add a follow-up note in code only if a specific caller needs event failure handling.

- [ ] **Step 4: Run tests**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/utils/EventBus.test.js build/tests/unit/logger/root-logger.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/EventBus.ts src/utils/logger.ts src/worker/ToolTelemetry.ts tests/unit/utils/EventBus.test.ts tests/unit/logger/root-logger.test.ts
git commit -m "Add observable async event support

EventBus keeps its existing fire-and-forget emit contract while adding
an async emission path for future orchestration code that must observe
listener failures. Logger field serialization is covered so telemetry can
emit structured details consistently.

Constraint: Existing emit callers must remain source-compatible
Confidence: high
Scope-risk: narrow
Tested: typecheck, build, EventBus and logger unit tests"
```

---

### Task 6: Make Runtime Services Lazy

**Files:**
- Create: `src/runtime/RuntimeServices.ts`
- Create: `tests/unit/runtime/RuntimeServices.test.ts`
- Modify: `src/runtime.ts`
- Modify: `src/worker/context/ServiceLocator.ts`

- [ ] **Step 1: Run GitNexus impact analysis**

```bash
npx gitnexus impact getRuntime --direction upstream
npx gitnexus impact Runtime --direction upstream
```

Expected: identify all direct callers. If risk is HIGH or CRITICAL, split this task into smaller runtime-only and service-locator-only commits.

- [ ] **Step 2: Create `RuntimeServices.ts`**

```ts
import {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import {CryptoDetector} from '../modules/crypto/CryptoDetector.js';
import {Deobfuscator} from '../modules/deobfuscator/Deobfuscator.js';
import {WasmAnalyzer} from '../modules/wasm/WasmAnalyzer.js';
import {WasmCollector} from '../modules/wasm/WasmCollector.js';
import {WasmDecompiler} from '../modules/wasm/WasmDecompiler.js';
import {WasmRuntimeInspector} from '../modules/wasm/WasmRuntimeInspector.js';
import {LLMService} from '../services/LLMService.js';
import type {PageController} from '../modules/collector/PageController.js';

export class RuntimeServices {
  private llmService?: LLMService;
  private analyzer?: CodeAnalyzer;
  private summarizer?: AISummarizer;
  private deobfuscator?: Deobfuscator;
  private cryptoDetector?: CryptoDetector;
  private wasmAnalyzer?: WasmAnalyzer;
  private wasmDecompiler?: WasmDecompiler;
  private wasmRuntimeInspector?: WasmRuntimeInspector;
  private wasmCollector?: WasmCollector;

  constructor(private readonly pageController: PageController) {}

  getLLMService(): LLMService {
    return (this.llmService ??= new LLMService());
  }

  getAnalyzer(): CodeAnalyzer {
    return (this.analyzer ??= new CodeAnalyzer(this.getLLMService()));
  }

  getSummarizer(): AISummarizer {
    return (this.summarizer ??= new AISummarizer(this.getLLMService()));
  }

  getDeobfuscator(): Deobfuscator {
    return (this.deobfuscator ??= new Deobfuscator(this.getLLMService()));
  }

  getCryptoDetector(): CryptoDetector {
    return (this.cryptoDetector ??= new CryptoDetector(this.getLLMService()));
  }

  getWasmAnalyzer(): WasmAnalyzer {
    return (this.wasmAnalyzer ??= new WasmAnalyzer());
  }

  getWasmDecompiler(): WasmDecompiler {
    return (this.wasmDecompiler ??= new WasmDecompiler());
  }

  getWasmRuntimeInspector(): WasmRuntimeInspector {
    return (this.wasmRuntimeInspector ??= new WasmRuntimeInspector());
  }

  getWasmCollector(): WasmCollector {
    return (this.wasmCollector ??= new WasmCollector(
      this.pageController,
      this.getWasmAnalyzer(),
      this.getWasmRuntimeInspector(),
    ));
  }
}
```

- [ ] **Step 3: Modify `runtime.ts` to expose getters without changing Runtime field names**

Use getter properties in the runtime object:

```ts
const services = new RuntimeServices(pageController);

runtime = {
  browserManager,
  collector,
  domInspector,
  pageController,
  hookManager,
  get llmService() {
    return services.getLLMService();
  },
  get analyzer() {
    return services.getAnalyzer();
  },
  get summarizer() {
    return services.getSummarizer();
  },
  get deobfuscator() {
    return services.getDeobfuscator();
  },
  get cryptoDetector() {
    return services.getCryptoDetector();
  },
  get wasmCollector() {
    return services.getWasmCollector();
  },
  get wasmAnalyzer() {
    return services.getWasmAnalyzer();
  },
  get wasmDecompiler() {
    return services.getWasmDecompiler();
  },
  get wasmRuntimeInspector() {
    return services.getWasmRuntimeInspector();
  },
  reverseTaskStore,
  eventBus,
  bindPageContext: resolver => {
    collector.setPageResolver(() => resolver());
  },
  syncPageContext: page => {
    collector.setPageResolver(() => page);
    browserManager.setCurrentPage(page);
  },
  clearPageContext: () => {
    collector.setPageResolver(undefined);
    browserManager.setCurrentPage(null);
  },
};
```

- [ ] **Step 4: Add tests**

`tests/unit/runtime/RuntimeServices.test.ts`:

```ts
test('RuntimeServices returns stable analyzer instances', () => {
  // Construct with a minimal PageController test double if existing tests do so.
  // Assert services.getAnalyzer() === services.getAnalyzer().
});

test('RuntimeServices does not create wasm collector until requested', () => {
  // Assert construction succeeds without touching wasm getters.
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/runtime/RuntimeServices.test.js build/tests/unit/worker/ToolContextProvider.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime.ts src/runtime/RuntimeServices.ts src/worker/context/ServiceLocator.ts tests/unit/runtime/RuntimeServices.test.ts
git commit -m "Lazy-load runtime analysis services

Runtime keeps its existing field contract while deferring LLM, analyzer,
deobfuscator, crypto, and WASM service construction until a tool actually
needs them. This follows the jshookmcp lazy-domain direction without
forcing a public Runtime API break.

Constraint: Preserve existing Runtime property names
Confidence: medium
Scope-risk: moderate
Tested: typecheck, build, runtime and context provider unit tests"
```

---

### Task 7: Add Profile-Aware Tool Registry

**Files:**
- Create: `src/tools/registry/ToolRegistry.ts`
- Create: `tests/unit/tools/ToolRegistry.profile.test.ts`
- Modify: `src/tools/manifest.ts`
- Modify: `scripts/generate-tools-index.ts`
- Modify: `src/cli/tools-meta.ts`

- [ ] **Step 1: Run GitNexus impact analysis**

```bash
npx gitnexus impact DomainManifest --direction upstream
npx gitnexus impact ensureToolsMeta --direction upstream
```

Expected: list generator, CLI, worker, tests. If risk is HIGH or CRITICAL, first add optional fields only and avoid changing registration behavior.

- [ ] **Step 2: Extend `DomainManifest` with optional metadata**

```ts
export type ToolProfile = 'search' | 'workflow' | 'full';

export interface DomainManifest {
  name: string;
  description: string;
  profile?: ToolProfile;
  dependencies?: string[];
  tools: Array<{
    modulePath: string;
    handlerName: string;
    profile?: ToolProfile;
  }>;
}
```

- [ ] **Step 3: Create `ToolRegistry.ts`**

```ts
import type {DomainManifest, ToolProfile} from '../manifest.js';

const PROFILE_ORDER: Record<ToolProfile, number> = {
  search: 0,
  workflow: 1,
  full: 2,
};

export class ToolRegistry {
  constructor(private readonly manifests: readonly DomainManifest[]) {}

  listTools(profile: ToolProfile = 'full') {
    const max = PROFILE_ORDER[profile];
    return this.manifests.flatMap(manifest =>
      manifest.tools
        .filter(tool => {
          const effectiveProfile = tool.profile ?? manifest.profile ?? 'workflow';
          return PROFILE_ORDER[effectiveProfile] <= max;
        })
        .map(tool => ({
          domain: manifest.name,
          modulePath: tool.modulePath,
          handlerName: tool.handlerName,
          profile: tool.profile ?? manifest.profile ?? 'workflow',
        })),
    );
  }
}
```

- [ ] **Step 4: Wire registry into `tools-meta.ts` without changing default behavior**

Default profile should be `full` for backward compatibility:

```ts
const profile = (process.env.JS_REVERSE_TOOL_PROFILE ?? 'full') as ToolProfile;
const registry = new ToolRegistry(GENERATED_DOMAIN_MANIFESTS);
const tools = registry.listTools(profile);
```

- [ ] **Step 5: Add tests**

```ts
test('ToolRegistry includes search tools in workflow profile', () => {});
test('ToolRegistry excludes full-only tools from workflow profile', () => {});
test('ToolRegistry defaults unspecified domains to workflow', () => {});
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm run typecheck
npm run build
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/ToolRegistry.profile.test.js build/tests/unit/cli/tools-meta.test.js build/tests/unit/worker/ToolAdapter.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools/manifest.ts src/tools/registry/ToolRegistry.ts scripts/generate-tools-index.ts src/cli/tools-meta.ts tests/unit/tools/ToolRegistry.profile.test.ts tests/unit/cli/tools-meta.test.ts
git commit -m "Introduce profile-aware tool registration

Tool metadata can now be filtered by search, workflow, or full profile
while preserving full registration as the default. This creates the
registry foundation needed for lighter startup profiles and future
domain activation policies.

Constraint: Default behavior remains full tool registration
Rejected: Runtime plugin discovery | unnecessary before profile metadata exists
Confidence: medium
Scope-risk: moderate
Tested: typecheck, build, registry and tools-meta unit tests"
```

---

### Task 8: Split Build Scripts and Expand Verification Surface

**Files:**
- Modify: `package.json`
- Modify: `tests/README.md`

- [ ] **Step 1: Split build scripts**

Change `package.json` scripts from one long build command to:

```json
{
  "build:index": "node --experimental-strip-types scripts/generate-tools-index.ts",
  "build:compile": "swc src tests -d build --extensions .ts",
  "build:post": "node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/post-build.ts",
  "build": "npm run build:index && npm run build:compile && npm run build:post"
}
```

Keep existing `build:dev`, `test:*`, `coverage:*` scripts.

- [ ] **Step 2: Add focused quality script**

Add:

```json
{
  "test:worker": "npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/**/*.test.js",
  "test:registry": "npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/ToolRegistry*.test.js"
}
```

- [ ] **Step 3: Update `tests/README.md`**

Add a short section:

```md
## Focused Refactor Suites

- `npm run test:worker` verifies the worker adapter, execution pipeline, context provider, and lifecycle units.
- `npm run test:registry` verifies generated tool metadata and profile-aware registry behavior.
- Run `npm run typecheck`, `npm run check-format`, and `npm run test:unit` before merging execution-pipeline or registry changes.
```

- [ ] **Step 4: Run verification**

Run:

```bash
npm run typecheck
npm run check-format
npm run test:worker
npm run test:registry
npm run test:unit
```

Expected: PASS.

- [ ] **Step 5: Run GitNexus detect changes before final commit**

```bash
npx gitnexus detect-changes
```

Expected: changed symbols and flows match this plan: worker execution pipeline, runtime services, tool registry, scripts/tests docs.

- [ ] **Step 6: Commit**

```bash
git add package.json tests/README.md
git commit -m "Clarify build and focused verification scripts

The optimization work adds focused worker and registry surfaces, so build
steps and test commands are split to make failures easier to isolate in
local development and CI.

Constraint: Preserve existing npm test and build entrypoints
Confidence: high
Scope-risk: narrow
Tested: typecheck, check-format, worker tests, registry tests, unit tests
Not-tested: Cross-platform CI shell behavior"
```

---

## Final Verification Checklist

- [ ] `npm run typecheck`
- [ ] `npm run check-format`
- [ ] `npm run test:worker`
- [ ] `npm run test:registry`
- [ ] `npm run test:unit`
- [ ] `npx gitnexus detect-changes`
- [ ] Manual smoke: start worker and call one `defineTool` tool, one `context` tool, one `frame` tool if browser context is available.

## Rollback Plan

- If Task 4 breaks worker calls, revert only the pipeline commit and keep Task 1-3 extractions if tests still pass.
- If Task 6 causes runtime initialization regressions, revert `RuntimeServices` commit; it is intentionally isolated from pipeline work.
- If Task 7 changes visible tool registration unexpectedly, set default profile back to `full` and disable env filtering while retaining optional manifest metadata.

## Known Risks

- `ToolAdapter` behavior is externally visible through worker RPC, so response shape changes are the highest-risk area.
- Lazy runtime getters preserve property names but may alter construction timing; any module depending on constructor side effects must be identified during impact analysis.
- Profile-aware registry must default to `full` until clients explicitly opt into lighter profiles.
- Large response offload changes payload shape for oversized responses; downstream clients must be compatible with `detailId` summary responses.

## Self-Review

- Spec coverage: The plan covers code structure, performance, maintainability, extensibility, error/logging, data flow, and build/test improvements.
- Placeholder scan: No task contains open-ended TODO/TBD instructions; code snippets are concrete implementation targets.
- Type consistency: New pipeline classes consistently use `ToolMeta`, `LoadedHandler`, `ToolContextProvider`, `ToolError`, and existing response accumulator types.
