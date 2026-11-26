/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {appendFileSync, mkdirSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {
  getToolResultRecordingConfig,
  type ResolvedToolResultRecordingConfig,
} from '../config.js';
import {
  formatConsoleMessageDetail,
  formatConsoleMessages,
} from '../formatters/consoleFormatter.js';
import {
  formatNetworkRequestDetail,
  formatNetworkRequests,
} from '../formatters/networkFormatter.js';
import {
  formatSnapshotInline,
  formatSnapshotSavedFile,
} from '../formatters/snapshotFormatter.js';
import type {WaitForEventsResult} from '../modules/browser/WaitForHelper.js';
import type {ConsoleMessage, Page} from '../third_party/index.js';
import type {
  ImageContentData,
  Response,
  SnapshotParams,
} from '../tools/ToolDefinition.js';
import {
  ArtifactStorage,
  type ArtifactStorageConfig,
} from '../utils/ArtifactStorage.js';
import type {ToolError} from '../utils/errors.js';
import {validateOutputPath} from '../utils/fsSafe.js';
import {logger} from '../utils/logger.js';
import {safeStringify} from '../utils/safeJson.js';
import {TokenBudgetManager} from '../utils/TokenBudgetManager.js';
import type {PaginationOptions} from '../utils/types.js';

import type {BrowserPage} from './BrowserPage.js';
import type {SessionContext} from './SessionContext.js';

type NetworkListOptions = PaginationOptions & {
  resourceTypes?: string[];
  includePreservedRequests?: boolean;
  networkRequestIdInDevToolsUI?: number;
};

type ConsoleListOptions = PaginationOptions & {
  types?: string[];
  includePreservedMessages?: boolean;
};

type WebSocketListOptions = PaginationOptions & {
  urlFilter?: string;
  includePreservedConnections?: boolean;
};

/**
 * ToolResponseAccumulator — DeclarativeResponse 统一物化器（ADR-0010）
 *
 * Tool handler 只声明输出意图（appendResponseLine / setStructuredContent /
 * includeSnapshot / setIncludePages / setIncludeNetworkRequests /
 * attachNetworkRequest / setIncludeConsoleData / attachConsoleMessage /
 * setIncludeWebSocketConnections / attachWebSocket / setListExtensions /
 * attachImage），在 materialize(session, targetPage) 阶段统一查数据并经
 * src/formatters/* 物化，同时产出 structuredContent 与可读文本摘要。
 */
export class ToolResponseAccumulator implements Response {
  private lines: string[] = [];
  private structuredContent: unknown = null;
  private includePages = false;
  private includeExtensions = false;
  private includeNetwork = false;
  private networkOptions?: NetworkListOptions;
  private includeConsole = false;
  private consoleOptions?: ConsoleListOptions;
  private includeWebSockets = false;
  private webSocketOptions?: WebSocketListOptions;
  private attachedNetworkRequestId?: number;
  private attachedConsoleMessageId?: number;
  private attachedWebSocketId?: number;
  private readonly images: ImageContentData[] = [];
  private snapshotParams?: SnapshotParams;
  private waitForResult?: WaitForEventsResult;
  private readonly capturedConsoleErrors: string[] = [];
  private readonly cleanupCallbacks: Array<() => void> = [];

  private materializedPages?: Array<{
    pageId: string;
    url: string;
    selected: boolean;
  }>;
  private materializedNetwork?: unknown;

  appendResponseLine(line: string): void {
    this.lines.push(line);
  }

  setStructuredContent(content: unknown): void {
    this.structuredContent = content;
  }

  getStructuredContent(): unknown {
    return this.structuredContent;
  }

  getResponseLines(): readonly string[] {
    return this.lines;
  }

  getAttachedImages(): readonly ImageContentData[] {
    return this.images;
  }

  setIncludePages(value: boolean): void {
    this.includePages = value;
  }

  setListExtensions(): void {
    this.includeExtensions = true;
  }

  includeSnapshot(params?: SnapshotParams): void {
    this.snapshotParams = params ?? {};
  }

  getSnapshotRequest(): SnapshotParams | undefined {
    return this.snapshotParams;
  }

  attachWaitForResult(result: WaitForEventsResult): void {
    this.waitForResult = result;
  }

  getWaitForResult(): WaitForEventsResult | undefined {
    return this.waitForResult;
  }

  includeConsoleErrorsFrom(page: Page): void {
    if (!page || typeof page.on !== 'function') {
      return;
    }
    const onConsole = (msg: ConsoleMessage): void => {
      try {
        if (msg.type() === 'error') {
          this.capturedConsoleErrors.push(msg.text());
        }
      } catch {
        // 忽略已销毁消息读取异常
      }
    };
    const onPageError = (err: Error): void => {
      this.capturedConsoleErrors.push(err.message || String(err));
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    this.cleanupCallbacks.push(() => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    });
  }

  getCapturedConsoleErrors(): readonly string[] {
    return this.capturedConsoleErrors;
  }

  cleanupListeners(): void {
    for (const cb of this.cleanupCallbacks.splice(0)) {
      try {
        cb();
      } catch {
        // 忽略监听清理异常
      }
    }
  }

  setIncludeNetworkRequests(
    value: boolean,
    options?: NetworkListOptions,
  ): void {
    this.includeNetwork = value;
    this.networkOptions = options;
  }

  setIncludeConsoleData(value: boolean, options?: ConsoleListOptions): void {
    this.includeConsole = value;
    this.consoleOptions = options;
  }

  attachImage(value: ImageContentData): void {
    this.images.push(value);
  }

  attachNetworkRequest(reqid: number): void {
    this.attachedNetworkRequestId = reqid;
  }

  attachConsoleMessage(msgid: number): void {
    this.attachedConsoleMessageId = msgid;
  }

  setIncludeWebSocketConnections(
    value: boolean,
    options?: WebSocketListOptions,
  ): void {
    this.includeWebSockets = value;
    this.webSocketOptions = options;
  }

  attachWebSocket(wsid: number): void {
    this.attachedWebSocketId = wsid;
  }

  /**
   * 统一物化全部声明式响应指令（ADR-0010）：
   * 集中读取目标页与会话数据、走 src/formatters/* 格式化并合并入 structuredContent。
   */
  async materialize(
    session: SessionContext,
    targetPage?: BrowserPage,
  ): Promise<void> {
    const bp = targetPage ?? session.getSelectedBrowserPage() ?? undefined;

    const hasEnrichment =
      Boolean(this.snapshotParams) ||
      Boolean(
        this.waitForResult && Object.keys(this.waitForResult).length > 0,
      ) ||
      this.capturedConsoleErrors.length > 0 ||
      this.includePages ||
      this.includeExtensions ||
      this.includeNetwork ||
      this.includeConsole ||
      this.includeWebSockets ||
      this.attachedNetworkRequestId !== undefined ||
      this.attachedConsoleMessageId !== undefined ||
      this.attachedWebSocketId !== undefined;

    if (!hasEnrichment) {
      return;
    }

    const base: Record<string, unknown> =
      this.structuredContent &&
      typeof this.structuredContent === 'object' &&
      !Array.isArray(this.structuredContent)
        ? {...(this.structuredContent as Record<string, unknown>)}
        : this.structuredContent !== null
          ? {value: this.structuredContent}
          : {success: true};

    if (this.waitForResult && Object.keys(this.waitForResult).length > 0) {
      base.events = this.waitForResult;
    }

    if (this.capturedConsoleErrors.length > 0) {
      base.consoleErrors = [...this.capturedConsoleErrors];
    }

    if (this.snapshotParams && bp) {
      const snapshot = await bp.captureSnapshot({
        mode: this.snapshotParams.mode ?? 'ax',
        verbose: this.snapshotParams.verbose ?? false,
      });
      if (this.snapshotParams.filePath) {
        const resolved = validateOutputPath(this.snapshotParams.filePath);
        await mkdir(path.dirname(resolved), {recursive: true});
        await writeFile(resolved, snapshot.formattedText, 'utf-8');
        const formatted = formatSnapshotSavedFile(snapshot, resolved);
        base.snapshot = formatted.payload;
        this.lines.push(formatted.line);
      } else {
        const formatted = formatSnapshotInline(snapshot);
        base.snapshot = formatted.payload;
        this.lines.push(formatted.line);
      }
    }

    if (this.includePages) {
      const pages = session.getPages();
      const selected = session.getSelectedPage();
      this.materializedPages = pages.map(page => ({
        pageId: session.getPageId(page),
        url: typeof page.url === 'function' ? page.url() : '',
        selected: page === selected,
      }));
      base.pages = this.materializedPages;
    }

    if (this.includeExtensions) {
      const extMap = await session.listExtensions();
      base.extensions = Array.from(extMap.values());
    }

    if (this.includeNetwork) {
      const requests = bp
        ? bp.getNetworkRequests(this.networkOptions?.includePreservedRequests)
        : session.getNetworkRequests(
            this.networkOptions?.includePreservedRequests,
          );
      const formatted = formatNetworkRequests(
        requests,
        req => session.getNetworkRequestStableId(req, bp?.rawPage),
        this.networkOptions,
      );
      this.materializedNetwork = formatted.items;
      base.network = {
        total: formatted.total,
        pageIdx: formatted.pageIdx,
        pageSize: formatted.pageSize,
        requests: formatted.items,
      };
      this.lines.push(...formatted.lines);
    }

    if (this.attachedNetworkRequestId !== undefined) {
      const req = session.getNetworkRequestById(
        this.attachedNetworkRequestId,
        bp?.rawPage,
      );
      const formatted = formatNetworkRequestDetail(
        this.attachedNetworkRequestId,
        req,
      );
      base.networkRequest = formatted.detail;
      this.lines.push(formatted.line);
    }

    if (this.includeConsole) {
      if (bp) {
        await bp.ensureConsoleEnabled();
      } else {
        await session.ensureConsoleEnabled();
      }
      const messages = bp
        ? bp.getConsoleData(this.consoleOptions?.includePreservedMessages)
        : session.getConsoleData(this.consoleOptions?.includePreservedMessages);
      const formatted = formatConsoleMessages(
        messages,
        msg => session.getConsoleMessageStableId(msg, bp?.rawPage),
        this.consoleOptions,
      );
      base.console = {
        total: formatted.total,
        pageIdx: formatted.pageIdx,
        pageSize: formatted.pageSize,
        messages: formatted.items,
      };
      this.lines.push(...formatted.lines);
    }

    if (this.attachedConsoleMessageId !== undefined) {
      const msg = session.getConsoleMessageById(
        this.attachedConsoleMessageId,
        bp?.rawPage,
      );
      const formatted = formatConsoleMessageDetail(
        this.attachedConsoleMessageId,
        msg,
      );
      base.consoleMessage = formatted.detail;
      this.lines.push(formatted.line);
    }

    if (this.includeWebSockets) {
      const connections = bp
        ? bp.getWebSocketConnections(
            this.webSocketOptions?.includePreservedConnections,
          )
        : session.getWebSocketConnections(
            this.webSocketOptions?.includePreservedConnections,
          );
      const filtered = this.webSocketOptions?.urlFilter
        ? connections.filter(c =>
            c.connection.url.includes(this.webSocketOptions!.urlFilter!),
          )
        : connections;
      base.websockets = filtered.map(c => ({
        wsid: session.getWebSocketStableId(c, bp?.rawPage),
        url: c.connection.url,
        framesCount: c.frames?.length ?? 0,
      }));
    }

    if (this.attachedWebSocketId !== undefined) {
      const ws = session.getWebSocketConnectionById(
        this.attachedWebSocketId,
        bp?.rawPage,
      );
      base.websocket = {
        wsid: this.attachedWebSocketId,
        url: ws.connection.url,
        framesCount: ws.frames?.length ?? 0,
      };
    }

    this.structuredContent = base;
  }

  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    if (this.structuredContent !== null) {
      result.structuredContent = this.structuredContent;
    }

    if (this.images.length > 0) {
      result.images = [...this.images];
    }

    if (this.includePages) {
      result.pages = this.materializedPages ?? [];
    }
    if (this.includeNetwork) {
      result.network = this.materializedNetwork ?? [];
    }

    return result;
  }
}

/**
 * @deprecated 所有工具 handler 已统一使用 setStructuredContent，不再产出 ```json 围栏。
 * 仅为外部消费者保留向后兼容，内部管线不再调用。
 */
function parseFencedJson(text: string): unknown {
  const match = text.match(/^```json\s*\n([\s\S]*?)\n```$/);
  if (!match) return undefined;

  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

// Keep the symbol referenced so tree-shaking doesn't drop it for external consumers.
export const _legacyParseFencedJson = parseFencedJson;

export interface ToolResponseProcessorConfig extends ArtifactStorageConfig {
  autoOffload?: boolean;
}

/**
 * ToolResponseProcessor — 统一的响应处理器，支持规范化与大响应 Reference over Value 文件落盘
 */
export class ToolResponseProcessor {
  private readonly storage: ArtifactStorage;
  private readonly autoOffload: boolean;

  constructor(config?: ToolResponseProcessorConfig) {
    this.autoOffload = config?.autoOffload ?? false;
    this.storage = new ArtifactStorage(config);
  }

  /**
   * 将 handler 原始返回值规范化为标准 Tool 响应结构
   */
  normalize(result: unknown): unknown {
    if (this.isToolDefinitionResponse(result)) {
      return result;
    }

    const accumulator = new ToolResponseAccumulator();
    accumulator.setStructuredContent(result);
    return accumulator.toJSON();
  }

  /**
   * 统一处理响应。如果启用了 autoOffload 且内容超过阈值，
   * 自动落盘至 artifacts 目录并返回 Reference-over-Value 引用元数据。
   */
  process(response: unknown, toolName?: string): unknown {
    if (!this.autoOffload) {
      return response;
    }

    if (
      typeof response === 'object' &&
      response !== null &&
      'structuredContent' in response
    ) {
      const respObj = response as Record<string, unknown>;
      const content = respObj.structuredContent;
      const effectiveToolName =
        toolName ??
        (typeof respObj.toolName === 'string'
          ? respObj.toolName
          : 'tool_output');

      if (this.storage.shouldOffload(content)) {
        return {
          ...respObj,
          structuredContent: this.storage.createReference(
            effectiveToolName,
            content,
          ),
        };
      }
    }

    return response;
  }

  private isToolDefinitionResponse(result: unknown): boolean {
    return (
      typeof result === 'object' &&
      result !== null &&
      ('content' in result || 'structuredContent' in result || 'text' in result)
    );
  }
}

export interface ToolResultRecord {
  toolName: string;
  traceId: string;
  success: boolean;
  startedAt: string;
  durationMs: number;
  input?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export class ToolResultRecorder {
  constructor(
    private readonly configProvider = getToolResultRecordingConfig,
    private readonly now = () => new Date(),
  ) {}

  record(record: ToolResultRecord): void {
    const config = this.configProvider();
    if (!config.enabled) return;

    try {
      this.write(config, this.normalizeRecord(record));
    } catch {
      // Tool result recording is diagnostic only; it must not affect tools.
    }
  }

  private normalizeRecord(record: ToolResultRecord): ToolResultRecord {
    const input = record.input ?? record.request;
    return input ? {...record, input: {...input}} : record;
  }

  private write(
    config: ResolvedToolResultRecordingConfig,
    record: ToolResultRecord,
  ): void {
    mkdirSync(config.outputDir, {recursive: true});
    const filePath = path.join(config.outputDir, this.fileName());
    appendFileSync(filePath, safeStringify(record) + '\n', 'utf-8');
  }

  private fileName(): string {
    return `${this.now().toISOString().slice(0, 10)}.jsonl`;
  }
}

export class ToolTelemetry {
  constructor(private readonly contextProvider: SessionContext) {}

  success(
    toolName: string,
    request: Record<string, unknown>,
    response: unknown,
    durationMs: number,
    traceId: string,
  ): void {
    TokenBudgetManager.getInstance().recordToolCall(
      toolName,
      request,
      response,
    );
    this.contextProvider.eventBus.emit('tool:called', {
      name: toolName,
      durationMs,
      success: true,
      traceId,
    });
    logger.info('tool.completed', {toolName, durationMs, traceId});
  }

  failure(
    toolName: string,
    error: ToolError,
    durationMs: number,
    traceId: string,
  ): void {
    this.contextProvider.eventBus.emit('tool:error', {
      name: toolName,
      code: error.code,
      message: error.message,
      traceId,
    });
    logger.warn('tool.failed', {
      toolName,
      durationMs,
      code: error.code,
      traceId,
    });
  }
}
