/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ImageContentData, Response} from '../tools/ToolDefinition.js';
import {DetailedDataManager} from '../utils/detailedDataManager.js';
import type {PaginationOptions} from '../utils/types.js';

/**
 * ToolResponseAccumulator — 复刻 Daemon 中 response 对象的 accumulator 模式
 *
 * Tool handler 通过 appendResponseLine / setStructuredContent 等方法累积结果，
 * 最终通过 toJSON() 输出统一格式。
 * 实现 defineTool 所需的 Response 接口。
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

    if (this.lines.length > 0) {
      const text = this.lines.join('\n');
      result.text = text;
      if (this.structuredContent === null) {
        const parsed = parseFencedJson(text);
        if (parsed !== undefined) {
          result.structuredContent = parsed;
        }
      }
    }

    if (this.structuredContent !== null) {
      result.structuredContent = this.structuredContent;
    }
    if (this.includePages) result.pages = [];
    if (this.includeNetwork) result.network = [];

    return result;
  }
}

function parseFencedJson(text: string): unknown {
  const match = text.match(/^```json\s*\n([\s\S]*?)\n```$/);
  if (!match) return undefined;

  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * ToolResponseProcessor — 统一的响应处理器，融合了规范化与大响应 Offload 逻辑
 */
export class ToolResponseProcessor {
  constructor(
    private readonly manager = DetailedDataManager.getInstance(),
    private readonly thresholdBytes = 512 * 1024,
  ) {}

  /**
   * 将 handler 原始返回值规范化为标准 MCP Tool 响应结构
   */
  normalize(result: unknown): unknown {
    if (this.isToolDefinitionResponse(result)) {
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

  /**
   * 统一处理响应，对超大字段进行 Offload 暂存
   */
  process(response: unknown): unknown {
    return this.manager.smartHandle(response, this.thresholdBytes);
  }

  private isToolDefinitionResponse(result: unknown): boolean {
    return (
      typeof result === 'object' &&
      result !== null &&
      ('content' in result || 'structuredContent' in result || 'text' in result)
    );
  }
}
