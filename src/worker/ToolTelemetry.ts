/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {TokenBudgetManager} from '../utils/TokenBudgetManager.js';
import type {ToolError} from '../utils/errors.js';
import {logger} from '../utils/logger.js';

import type {ToolContextProvider} from './ToolContextProvider.js';

export class ToolTelemetry {
  constructor(private readonly contextProvider: ToolContextProvider) {}

  success(
    toolName: string,
    request: Record<string, unknown>,
    response: unknown,
    durationMs: number,
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
    });
    logger.info('tool.completed', {toolName, durationMs});
  }

  failure(toolName: string, error: ToolError, durationMs: number): void {
    this.contextProvider.eventBus.emit('tool:error', {
      name: toolName,
      code: error.code,
      message: error.message,
    });
    logger.warn('tool.failed', {
      toolName,
      durationMs,
      code: error.code,
    });
  }
}
