/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ToolError} from '../utils/errors.js';
import {logger} from '../utils/logger.js';
import {TokenBudgetManager} from '../utils/TokenBudgetManager.js';

import type {ToolContextProvider} from './ToolContextProvider.js';

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
