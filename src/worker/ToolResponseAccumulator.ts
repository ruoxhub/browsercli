/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {PaginationOptions} from '../utils/types.js';
import type {ImageContentData, Response} from '../tools/ToolDefinition.js';

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
      result.text = this.lines.join('\n');
    }
    if (this.structuredContent !== null) {
      result.structuredContent = this.structuredContent;
    }
    if (this.includePages) {
      result.pages = [];
    }
    if (this.includeNetwork) {
      result.network = [];
    }
    return result;
  }
}
