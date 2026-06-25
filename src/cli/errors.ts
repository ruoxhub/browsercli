/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 错误工具 — 项目特有的错误构造函数
 *
 * AxiError 本身从 axi-sdk-js 直接导入，此文件仅提供领域特定的便捷构造
 */

import {AxiError} from 'axi-sdk-js';

export {AxiError};

export function toAxiError(
  error: unknown,
  fallbackCode = 'INTERNAL',
): AxiError {
  if (error instanceof AxiError) return error;
  if (error instanceof Error) {
    return new AxiError(error.message, fallbackCode, [
      'Check Worker status with "browsercli status"',
      'Ensure browser is running with --remote-debugging-port=9222',
    ]);
  }
  return new AxiError(String(error), fallbackCode);
}

export function daemonError(action: string, details?: string): AxiError {
  const suggestions = [
    'Run "browsercli start" to launch the Worker',
    'Check Worker logs for more details',
  ];
  if (details) suggestions.unshift(details);
  return new AxiError(
    `Failed to ${action}: Worker unavailable`,
    'WORKER_ERROR',
    suggestions,
  );
}

export function toolError(tool: string, reason: string): AxiError {
  return new AxiError(`Tool "${tool}" failed: ${reason}`, 'TOOL_ERROR', [
    'Verify the Worker is running',
    'Check tool parameters are valid',
  ]);
}
