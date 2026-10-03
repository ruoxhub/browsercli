/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {appendFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

import {
  getToolResultRecordingConfig,
  type ResolvedToolResultRecordingConfig,
} from '../config.js';
import type {ImageContentData, Response} from '../tools/ToolDefinition.js';
import {
  ArtifactStorage,
  type ArtifactStorageConfig,
} from '../utils/ArtifactStorage.js';
import type {ToolError} from '../utils/errors.js';
import {logger} from '../utils/logger.js';
import {safeStringify} from '../utils/safeJson.js';
import {TokenBudgetManager} from '../utils/TokenBudgetManager.js';
import type {PaginationOptions} from '../utils/types.js';

import type {ToolContextProvider} from './ToolContext.js';

/**
 * ToolResponseAccumulator — 复刻 Daemon 中 response 对象的 accumulator 模式
 *
 * Tool handler 通过 appendResponseLine / setStructuredContent 等方法累积结果，
 * 最终通过 toJSON() 输出统一格式。
 * 实现 defineTool 所需 the Response 接口。
 */
export class ToolResponseAccumulator implements Response {
  private lines: string[] = [];
  private structuredContent: unknown = null;
  private includePages = false;
  private includeNetwork = false;

  appendResponseLine(line: string): void {
    this.lines.push(line);
  }

  setStructuredContent(content: unknown): void {
    this.structuredContent = content;
  }

  setIncludePages(value: boolean): void {
    this.includePages = value;
  }

  setIncludeNetworkRequests(
    _value: boolean,
    _options?: PaginationOptions & {
      resourceTypes?: string[];
      includePreservedRequests?: boolean;
      networkRequestIdInDevToolsUI?: number;
    },
  ): void {
    this.includeNetwork = _value;
  }

  setIncludeConsoleData(
    _value: boolean,
    _options?: PaginationOptions & {
      types?: string[];
      includePreservedMessages?: boolean;
    },
  ): void {
    // no-op for worker mode
  }

  attachImage(_value: ImageContentData): void {
    // no-op for worker mode
  }

  attachNetworkRequest(_reqid: number): void {
    // no-op for worker mode
  }

  attachConsoleMessage(_msgid: number): void {
    // no-op for worker mode
  }

  setIncludeWebSocketConnections(
    _value: boolean,
    _options?: PaginationOptions & {
      urlFilter?: string;
      includePreservedConnections?: boolean;
    },
  ): void {
    // no-op for worker mode
  }

  attachWebSocket(_wsid: number): void {
    // no-op for worker mode
  }

  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    if (this.structuredContent !== null) {
      result.structuredContent = this.structuredContent;
    }

    if (this.includePages) result.pages = [];
    if (this.includeNetwork) result.network = [];

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
   * 将 handler 原始返回值规范化为标准 MCP Tool 响应结构
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
  constructor(private readonly contextProvider: ToolContextProvider) {}

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
