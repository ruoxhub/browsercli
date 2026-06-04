/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {validateToolArgs, type ValidationFailure} from '../cli/tool-arg-validator.js';
import type {ToolMeta} from '../cli/tools-meta.js';
import type {ToolPrerequisiteChecker} from '../tools/prerequisites/ToolPrerequisiteChecker.js';
import {createToolError, ErrorCodes, ToolError} from '../utils/errors.js';

import type {ToolCallContextGuard} from './ToolCallContextGuard.js';
import type {ToolExecutionRouter} from './ToolExecutionRouter.js';
import type {ToolHandlerLoader} from './ToolHandlerLoader.js';
import type {ToolResponseProcessor} from './ToolResponseProcessor.js';
import {ToolResultRecorder} from './ToolResultRecorder.js';
import type {ToolTelemetry} from './ToolTelemetry.js';

export class ToolExecutionPipeline {
  constructor(
    private readonly loader: ToolHandlerLoader,
    private readonly router: ToolExecutionRouter,
    private readonly processor: ToolResponseProcessor,
    private readonly telemetry: ToolTelemetry,
    private readonly contextGuard?: ToolCallContextGuard,
    private readonly prerequisiteChecker?: ToolPrerequisiteChecker,
    private readonly resultRecorder = new ToolResultRecorder(),
  ) {}

  async execute(meta: ToolMeta, rawParams: unknown): Promise<unknown> {
    const startedAt = Date.now();
    const traceId = `tr_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
          (validated as ValidationFailure).error,
          {toolName},
        );
      }

      params = validated.value;
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
      const normalized = this.processor.normalize(rawResult);
      this.contextGuard?.recordCall(toolName);
      const enriched =
        this.contextGuard?.enrichResponse(toolName, normalized) ?? normalized;
      const response = this.processor.process(enriched);
      this.telemetry.success(
        toolName,
        params,
        response,
        Date.now() - startedAt,
        traceId,
      );
      this.resultRecorder.record({
        toolName,
        traceId,
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
      this.telemetry.failure(
        toolName,
        toolError,
        Date.now() - startedAt,
        traceId,
      );
      this.resultRecorder.record({
        toolName,
        traceId,
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
}
