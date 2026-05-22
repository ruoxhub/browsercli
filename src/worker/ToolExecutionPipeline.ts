/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {validateToolArgs} from '../cli/tool-arg-validator.js';
import type {ToolMeta} from '../cli/tools-meta.js';
import type {ToolPrerequisiteChecker} from '../tools/prerequisites/ToolPrerequisiteChecker.js';
import {createToolError, ErrorCodes, ToolError} from '../utils/errors.js';

import type {ToolCallContextGuard} from './ToolCallContextGuard.js';
import type {ToolExecutionRouter} from './ToolExecutionRouter.js';
import type {ToolHandlerLoader} from './ToolHandlerLoader.js';
import {ToolResponseAccumulator} from './ToolResponseAccumulator.js';
import type {ToolResponseOffloader} from './ToolResponseOffloader.js';
import {ToolResultRecorder} from './ToolResultRecorder.js';
import type {ToolTelemetry} from './ToolTelemetry.js';

export class ToolExecutionPipeline {
  constructor(
    private readonly loader: ToolHandlerLoader,
    private readonly router: ToolExecutionRouter,
    private readonly offloader: ToolResponseOffloader,
    private readonly telemetry: ToolTelemetry,
    private readonly contextGuard?: ToolCallContextGuard,
    private readonly prerequisiteChecker?: ToolPrerequisiteChecker,
    private readonly resultRecorder = new ToolResultRecorder(),
  ) {}

  async execute(meta: ToolMeta, rawParams: unknown): Promise<unknown> {
    const startedAt = Date.now();
    const toolName = meta.name;
    let params: Record<string, unknown> | undefined;

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

      params = (validated as {ok: true; value: Record<string, unknown>}).value;
      this.prerequisiteChecker?.check(toolName, meta.prerequisites);
      const handler = await this.loader.load(meta);
      if (!handler) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Tool handler 未找到: ${toolName}`,
          {toolName},
        );
      }

      const rawResult = await this.router.execute(meta, handler, params);
      const normalized = this.normalizeResponse(rawResult);
      this.contextGuard?.recordCall(toolName);
      const enriched =
        this.contextGuard?.enrichResponse(toolName, normalized) ?? normalized;
      const response = this.offloader.handle(enriched);
      this.telemetry.success(
        toolName,
        params,
        response,
        Date.now() - startedAt,
      );
      this.resultRecorder.record({
        toolName,
        success: true,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        input: params,
        request: params,
        response,
      });
      return response;
    } catch (error) {
      const toolError =
        error instanceof ToolError
          ? error
          : createToolError(
              ErrorCodes.RUNTIME,
              error instanceof Error ? error.message : String(error),
              {toolName},
            );
      this.telemetry.failure(toolName, toolError, Date.now() - startedAt);
      this.resultRecorder.record({
        toolName,
        success: false,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        input: params,
        request: params,
        error: {
          code: toolError.code,
          message: toolError.message,
        },
      });
      throw toolError;
    }
  }

  private normalizeResponse(result: unknown): unknown {
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

  private isToolDefinitionResponse(result: unknown): boolean {
    return (
      typeof result === 'object' &&
      result !== null &&
      ('content' in result || 'structuredContent' in result || 'text' in result)
    );
  }
}
