/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {TrafficSummary} from '../formatters/websocketFormatter.js';
import type {BrowserTargetInspector} from '../modules/browser/BrowserTargetInspector.js';
import type {
  ScreenRecorderData,
  ScreenRecordingHandle,
  StartScreenRecordingOptions,
} from '../modules/browser/CdpScreenRecording.js';
import type {EmulateOptions} from '../modules/browser/EmulationManager.js';
import type {BrowserManager} from '../modules/browser/index.js';
import type {
  PageSelector,
  ResolvedPage,
} from '../modules/browser/PageIdentity.js';
import type {
  WaitForEventsOptions,
  WaitForEventsResult,
} from '../modules/browser/WaitForHelper.js';
import type {CodeCollector} from '../modules/collector/CodeCollector.js';
import type {DOMInspector} from '../modules/collector/DOMInspector.js';
import type {PageController} from '../modules/collector/PageController.js';
import type {DebuggerManager} from '../modules/debugger/DebuggerManager.js';
import type {
  Logpoint,
  LogpointOptions,
} from '../modules/debugger/LogpointManager.js';
import type {
  HookDataRecord,
  HookManager,
  HookStore,
  HookTypeRegistry,
  PersistentHookRegistry,
} from '../modules/hook/index.js';
import type {NetworkModule} from '../modules/network/index.js';
import type {
  NetworkMockFilter,
  NetworkMockInput,
  NetworkOverride,
} from '../modules/network/NetworkMockManager.js';
import type {
  NetworkServices,
  RequestInitiator,
  WebSocketData,
} from '../modules/network/NetworkTypes.js';
import type {
  ExtendedSnapshotOptions,
  PageSnapshotManager,
} from '../modules/snapshot/PageSnapshotManager.js';
import type {TextSnapshotResult} from '../modules/snapshot/types.js';
import type {WasmAnalyzer} from '../modules/wasm/WasmAnalyzer.js';
import type {WasmCollector} from '../modules/wasm/WasmCollector.js';
import type {WasmDecompiler} from '../modules/wasm/WasmDecompiler.js';
import type {WasmRuntimeInspector} from '../modules/wasm/WasmRuntimeInspector.js';
import {zod} from '../third_party/index.js';
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Dialog,
  Frame,
  HTTPRequest,
  Page,
} from '../third_party/index.js';
import type {PaginationOptions} from '../utils/types.js';

import type {ToolCategory} from './categories.js';

export interface ToolRuntimeRequirements {
  browser?: 'connected';
  page?: 'selected';
  frame?: 'selected';
  debugger?: 'available' | 'paused' | 'running';
  nativeTools?: string[];
  recovery?: boolean;
}

/**
 * 并发队列策略（参考 chrome-devtools-mcp）：
 * - `'exclusive'`: 独占浏览器上下文锁，同一时间仅运行此工具
 * - `'page'`: 单页维度锁，不同页面可并发，同页面串行
 * - `'none'`: 无锁，可与其他工具并发（适用于只读或无状态等待工具）
 */
export type ToolConcurrency = 'exclusive' | 'page' | 'none';

/**
 * 工具在类型层声明的运行作用域（ADR-0008）：
 * - `'page'`: 绑定到单个 `ContextPage`（支持可选 `pageId` 路由与按页并发队列）
 * - `'browser'`: 操作浏览器级或跨页状态（不能使用 `'page'` 队列，需显式处理弹窗）
 * - `'stateless'`: 离线/无浏览器依赖工具
 */
export type ToolScope = 'page' | 'browser' | 'stateless';

export interface SnapshotParams {
  verbose?: boolean;
  filePath?: string;
  mode?: 'ax' | 'vom';
}

export interface NewPageOptions {
  background?: boolean;
  isolatedContext?: string;
}

/**
 * 页级聚合根契约（由 `BrowserPage` 实现）。
 * 页级工具在编译期获得非空 `ContextPage`，无需手动判空或访问全局单例。
 */
export interface ContextPage {
  readonly id: string;
  readonly rawPage: Page;
  isClosed(): boolean;
  getSelectedFrame(): Frame;
  selectFrame(frame: Frame | null): void;
  selectFrameByIdx(idx: number): Frame | null;
  getDialog(): Dialog | undefined;
  clearDialog(): void;
  setNetworkConditions(conditions: string | null): void;
  getNetworkConditions(): string | null;
  setCpuThrottlingRate(rate: number): void;
  getCpuThrottlingRate(): number;
  emulate(options: EmulateOptions): Promise<void>;
  waitForEventsAfterAction(
    action: (signal: AbortSignal) => Promise<unknown>,
    options?: WaitForEventsOptions,
  ): Promise<WaitForEventsResult>;
  waitForTextOnPage(params: {
    text: string | string[];
    timeout?: number;
    visible?: boolean;
  }): Promise<void>;
  bringToFront(): Promise<void>;
  ensureDebugger(): Promise<DebuggerManager>;
  getExistingDebugger(): DebuggerManager | undefined;
  disposeDebugger(): Promise<void>;
  mockNetwork(input: NetworkMockInput): Promise<NetworkOverride>;
  listNetworkMocks(filter?: NetworkMockFilter): NetworkOverride[];
  removeNetworkMocks(filter: NetworkMockFilter): Promise<number>;
  setLogpoints(desired: LogpointOptions[]): Promise<Logpoint[]>;
  getLogpoints(): Logpoint[];
  getHookStore(): HookStore<HookDataRecord>;
  captureSnapshot(
    options?: ExtendedSnapshotOptions,
  ): Promise<TextSnapshotResult>;
  getNetworkRequests(includePreserved?: boolean): HTTPRequest[];
  clearNetworkRequests(): void;
  ensureConsoleEnabled(): Promise<void>;
  getConsoleData(includePreserved?: boolean): Array<ConsoleMessage | Error>;
  getWebSocketConnections(includePreserved?: boolean): WebSocketData[];
  getScreenRecorder(): ScreenRecorderData | null;
  setScreenRecorder(data: ScreenRecorderData | null): void;
  startScreenRecording(
    options: StartScreenRecordingOptions,
  ): Promise<ScreenRecordingHandle>;
}

export interface ToolAnnotations {
  title?: string;
  category: ToolCategory;
  /**
   * If true, the tool does not modify its environment.
   */
  readOnlyHint: boolean;
  requirements?: ToolRuntimeRequirements;
}

export interface ToolDefinition<
  Schema extends zod.ZodRawShape = zod.ZodRawShape,
> {
  name: string;
  aliases?: string[];
  description: string;
  scope?: ToolScope;
  annotations: ToolAnnotations;
  /**
   * 若为 true，当当前页面存在未处理的 JS 弹窗（alert/confirm/prompt）时快速失败并提示调用 handle_dialog。
   */
  blockedByDialog?: boolean;
  /**
   * 并发执行队列模式，默认不加队列。
   */
  concurrency?: ToolConcurrency;
  schema: Schema;
  handler: (
    request: Request<Schema>,
    response: Response,
    context: Context,
  ) => Promise<void>;
}

export type PageToolSchema<Schema extends zod.ZodRawShape> = Schema & {
  pageId?: zod.ZodOptional<zod.ZodString>;
};

export interface PageRequest<Schema extends zod.ZodRawShape> {
  params: zod.objectOutputType<Schema, zod.ZodTypeAny> & {pageId?: string};
  page: ContextPage;
}

export interface PageToolDefinition<
  Schema extends zod.ZodRawShape = zod.ZodRawShape,
> {
  name: string;
  aliases?: string[];
  description: string;
  scope: 'page';
  /**
   * 是否在未显式传 pageId 时强制要求存在已选中页面（默认 true）。
   * 仅对支持离线/进程内降级的混合工具（如 create_hook / get_hook_data /
   * list_created_hooks / remove_hook / collect_code）设为 false；
   * 一旦显式传入 pageId，仍严格校验目标页面存在性。
   */
  requirePage?: boolean;
  annotations: ToolAnnotations;
  blockedByDialog?: boolean;
  concurrency?: 'page' | 'exclusive' | 'none';
  schema: PageToolSchema<Schema>;
  handler: (
    request: {
      params: zod.objectOutputType<Schema, zod.ZodTypeAny> & {pageId?: string};
      page?: ContextPage;
    },
    response: Response,
    context: Context,
  ) => Promise<void>;
}

export interface BrowserToolDefinition<
  Schema extends zod.ZodRawShape = zod.ZodRawShape,
> extends ToolDefinition<Schema> {
  scope: 'browser';
  blockedByDialog?: false;
  concurrency?: 'exclusive' | 'none';
}

export interface StatelessToolDefinition<
  Schema extends zod.ZodRawShape = zod.ZodRawShape,
> extends ToolDefinition<Schema> {
  scope: 'stateless';
  blockedByDialog?: false;
  concurrency?: 'none';
}

export type AnyToolDefinition<
  Schema extends zod.ZodRawShape = zod.ZodRawShape,
> =
  | ToolDefinition<Schema>
  | PageToolDefinition<Schema>
  | BrowserToolDefinition<Schema>
  | StatelessToolDefinition<Schema>;

export function isPageToolDefinition(
  tool: AnyToolDefinition,
): tool is PageToolDefinition {
  return tool.scope === 'page';
}

export interface Request<Schema extends zod.ZodRawShape> {
  params: zod.objectOutputType<Schema, zod.ZodTypeAny>;
}

export interface ImageContentData {
  data: string;
  mimeType: string;
}

export interface DevToolsData {
  cdpRequestId?: string;
  cdpBackendNodeId?: number;
}

export interface Extension {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  path: string;
}

export interface Response {
  appendResponseLine(value: string): void;
  setStructuredContent<T = unknown>(content: T): void;
  setIncludePages(value: boolean): void;
  setListExtensions?(): void;
  includeSnapshot?(params?: SnapshotParams): void;
  attachWaitForResult?(result: WaitForEventsResult): void;
  includeConsoleErrorsFrom?(page: Page): void;
  setIncludeNetworkRequests(
    value: boolean,
    options?: PaginationOptions & {
      resourceTypes?: string[];
      includePreservedRequests?: boolean;
      networkRequestIdInDevToolsUI?: number;
    },
  ): void;
  setIncludeConsoleData(
    value: boolean,
    options?: PaginationOptions & {
      types?: string[];
      includePreservedMessages?: boolean;
    },
  ): void;
  attachImage(value: ImageContentData): void;
  attachNetworkRequest(reqid: number): void;
  attachConsoleMessage(msgid: number): void;
  // WebSocket methods
  setIncludeWebSocketConnections(
    value: boolean,
    options?: PaginationOptions & {
      urlFilter?: string;
      includePreservedConnections?: boolean;
    },
  ): void;
  attachWebSocket(wsid: number): void;
}

/**
 * Only add methods required by tools/*.
 */
export type Context = Readonly<{
  getBrowserTargetInspector(): BrowserTargetInspector;
  /**
   * 返回当前目标页聚合根（支持显式 pageId 路由）。
   */
  getTargetPage?(): ContextPage | null;
  resolveBrowserPage?(selector?: PageSelector): ContextPage;
  /**
   * 返回当前选中的页面；若未选中任何页面则返回 null。
   * 调用方必须在使用前做 null 检查，否则会在运行时得到 TypeError。
   */
  getSelectedPage(): Page | null;
  getBrowserContext(): BrowserContext | null;
  getPersistentHookRegistry(): PersistentHookRegistry;
  getDialog(): Dialog | undefined;
  clearDialog(): void;
  getPageByIdx(idx: number): Page;
  getPageId(page: Page): string;
  resolvePage(selector: PageSelector): ResolvedPage;
  isPageSelected(page: Page): boolean;
  newPage(options?: NewPageOptions): Promise<Page>;
  closePage(pageIdx: number): Promise<void>;
  closePageBySelector?(selector: PageSelector): Promise<void>;
  selectPage(page: Page): void;
  bringPageToFront(page: Page): Promise<void>;
  syncPageContext(page: Page): void;
  getPages(): Page[];
  isBrowserConnected?(): boolean;
  ensureConnectedBrowser?(): Promise<Browser | null>;
  getSelectedFrame(): Frame;
  selectFrame(frame: Frame): void;
  resetSelectedFrame(): void;
  setNetworkConditions(conditions: string | null): void;
  setCpuThrottlingRate(rate: number): void;
  emulate?(options: EmulateOptions): Promise<void>;
  saveTemporaryFile(
    data: Uint8Array<ArrayBufferLike>,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  ): Promise<{filename: string}>;
  saveFile(
    data: Uint8Array<ArrayBufferLike>,
    filename: string,
  ): Promise<{filename: string}>;
  ensureExtension?<Extension extends `.${string}`>(
    filePath: string,
    extension: Extension,
  ): Promise<`${string}${Extension}`>;
  getScreencastFps?(): number | undefined;
  waitForEventsAfterAction(
    action: (signal: AbortSignal) => Promise<unknown>,
    options?: WaitForEventsOptions,
  ): Promise<WaitForEventsResult | void>;
  waitForTextOnPage(params: {
    text: string | string[];
    timeout?: number | undefined;
    visible?: boolean | undefined;
  }): Promise<Element | void>;
  getDevToolsData(): Promise<DevToolsData>;
  /**
   * Returns a reqid for a cdpRequestId.
   */
  resolveCdpRequestId(cdpRequestId: string): number | undefined;
  /**
   * Get the debugger context for script/breakpoint management.
   * Returns a promise because the underlying CDP session must be attached
   * lazily on first use.
   */
  getDebuggerContext(): Promise<DebuggerManager>;
  /**
   * Peek the debugger context without activating CDP.
   */
  getExistingDebuggerContext?(): DebuggerManager | undefined;
  /**
   * Get the initiator (call stack) for a network request.
   */
  getRequestInitiator(request: HTTPRequest): RequestInitiator | undefined;
  /**
   * Get the initiator by request ID.
   */
  getRequestInitiatorById(requestId: number): RequestInitiator | undefined;
  /**
   * Get network request by ID.
   */
  getNetworkRequestById(reqid: number): HTTPRequest;
  /**
   * Get captured requests without selecting an individual request.
   */
  getNetworkRequests?(includePreservedRequests?: boolean): HTTPRequest[];
  getNetworkRequestStableId?(request: unknown): number;
  clearNetworkRequests?(pageIdx?: number): void;
  /**
   * Console data accessors (for DeclarativeResponse & console tools)
   */
  ensureConsoleEnabled?(): Promise<void>;
  getConsoleData?(
    includePreservedMessages?: boolean,
  ): Array<ConsoleMessage | Error>;
  getConsoleMessageById?(id: number): ConsoleMessage | Error;
  getConsoleMessageStableId?(message: unknown): number;
  /**
   * Network mock methods
   */
  mockNetwork?(input: NetworkMockInput): Promise<NetworkOverride>;
  listNetworkMocks?(filter?: NetworkMockFilter): NetworkOverride[];
  removeNetworkMocks?(filter: NetworkMockFilter): Promise<number>;
  /**
   * Logpoint methods
   */
  setLogpoints?(desired: LogpointOptions[]): Promise<Logpoint[]>;
  getLogpoints?(): Logpoint[];
  /**
   * Get all WebSocket connections for the selected page.
   */
  getWebSocketConnections(includePreservedData?: boolean): WebSocketData[];
  /**
   * Get a WebSocket connection by stable ID.
   */
  getWebSocketById(wsid: number): WebSocketData;
  /**
   * Get stable ID for a WebSocket connection.
   */
  getWebSocketStableId(ws: WebSocketData): number;
  /**
   * Cache traffic summary for a WebSocket connection.
   */
  cacheTrafficSummary(wsid: number, summary: TrafficSummary): void;
  /**
   * Get cached traffic summary for a WebSocket connection.
   */
  getCachedTrafficSummary(wsid: number): TrafficSummary | undefined;
  /**
   * Extension management methods
   */
  installExtension(path: string): Promise<string>;
  uninstallExtension(id: string): Promise<void>;
  listExtensions(): Promise<Map<string, Extension>>;
  getExtension(id: string): Promise<Extension | undefined>;
  triggerExtensionAction(id: string): Promise<void>;
  /**
   * SessionContext 显式服务访问器（ADR-0008：替代 tools/* 中对 getRuntime() 的全局旁路调用）。
   */
  getBrowserManager?(): BrowserManager | null;
  getCodeCollector?(): CodeCollector;
  getDOMInspector?(): DOMInspector;
  getPageController?(): PageController;
  getHookManager?(): HookManager;
  getHookTypeRegistry?(): HookTypeRegistry;
  getPageHookStore?(): HookStore<HookDataRecord> | null;
  getNetworkModule?(): NetworkModule;
  getNetworkServices?(): NetworkServices;
  isCollectorRunning?(): Promise<boolean>;
  recordPageHealthy?(pageId?: string): void;
  getWasmCollector?(): WasmCollector;
  getWasmAnalyzer?(): WasmAnalyzer;
  getWasmDecompiler?(): WasmDecompiler;
  getWasmRuntimeInspector?(): WasmRuntimeInspector;
  getSnapshotManager?(): PageSnapshotManager;
}>;

/**
 * 定义工具的基础工厂函数（向后兼容存量 104 个工具）。
 */
export function defineTool<Schema extends zod.ZodRawShape>(
  definition: ToolDefinition<Schema>,
) {
  return definition;
}

const PAGE_ID_FIELD = zod
  .string()
  .optional()
  .describe(
    'Optional stable pageId from list_pages (e.g. 1, 2) to target a specific tab without switching global selection.',
  );

/**
 * 定义页级工具（ADR-0008）：
 * - 自动注入可选 `pageId` 参数以支持多页并行路由；
 * - 默认启用 `'page'` 维度并发队列；
 * - handler 在编译期接收非空 `request.page: ContextPage`。
 */
export function definePageTool<Schema extends zod.ZodRawShape>(
  definition: Omit<
    PageToolDefinition<Schema>,
    'scope' | 'schema' | 'handler'
  > & {
    schema: Schema;
    handler: (
      request: PageRequest<Schema>,
      response: Response,
      context: Context,
    ) => Promise<void>;
  },
): PageToolDefinition<Schema> {
  const schemaWithPageId = (
    'pageId' in definition.schema
      ? definition.schema
      : {...definition.schema, pageId: PAGE_ID_FIELD}
  ) as PageToolSchema<Schema>;

  return {
    ...definition,
    scope: 'page',
    concurrency: definition.concurrency ?? 'page',
    schema: schemaWithPageId,
    handler: definition.handler as PageToolDefinition<Schema>['handler'],
  };
}

/**
 * 定义浏览器级工具（ADR-0008）：操作跨页或连接级状态，类型层禁止 `'page'` 队列与 `blockedByDialog: true`。
 */
export function defineBrowserTool<Schema extends zod.ZodRawShape>(
  definition: Omit<BrowserToolDefinition<Schema>, 'scope'>,
): BrowserToolDefinition<Schema> {
  return {
    ...definition,
    scope: 'browser',
    blockedByDialog: false,
    concurrency: definition.concurrency ?? 'exclusive',
  };
}

/**
 * 定义无状态/离线工具（ADR-0008）：不依赖浏览器连接，无锁并发执行。
 */
export function defineStatelessTool<Schema extends zod.ZodRawShape>(
  definition: Omit<StatelessToolDefinition<Schema>, 'scope'>,
): StatelessToolDefinition<Schema> {
  return {
    ...definition,
    scope: 'stateless',
    blockedByDialog: false,
    concurrency: 'none',
  };
}

export const CLOSE_PAGE_ERROR =
  'The last open page cannot be closed. It is fine to keep it open.';

export const timeoutSchema = {
  timeout: zod
    .number()
    .int()
    .optional()
    .describe(
      `Maximum wait time in milliseconds. If set to 0, the default timeout will be used.`,
    )
    .transform(value => {
      return value && value <= 0 ? undefined : value;
    }),
};

export function zodTransform<Input, Output>(
  transform: (arg: Input) => Output,
): (arg: Input, ctx: zod.RefinementCtx) => Output {
  return (arg: Input, ctx: zod.RefinementCtx): Output => {
    try {
      return transform(arg);
    } catch (error) {
      if (error instanceof zod.ZodError) {
        for (const issue of error.issues) {
          ctx.addIssue({
            code: 'custom',
            message: issue.message,
            path: issue.path,
          });
        }
      } else {
        ctx.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return zod.NEVER;
    }
  };
}
