/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolResponseAccumulator — 复刻 Daemon 中 response 对象的 accumulator 模式
 *
 * Tool handler 通过 appendResponseLine / setStructuredContent 等方法累积结果，
 * 最终通过 toJSON() 输出统一格式
 */

export class ToolResponseAccumulator {
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

  setIncludeNetworkRequests(value: boolean): void {
    this.includeNetwork = value;
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
