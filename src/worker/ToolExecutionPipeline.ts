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
import {type LoadedHandler, type ToolHandlerLoader} from './ToolHandlerLoader.js';
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
    const traceId = this.generateTraceId(startedAt);
    const toolName = meta.name;
    let params: Record<string, unknown> | undefined;

    try {
      params = this.validateAndPrepare(toolName, rawParams, meta);
      const handler = await this.loadHandler(toolName, meta);
      const response = await this.processRequest(meta, handler, params, toolName);

      this.recordSuccess(toolName, params, response, startedAt, traceId);
      return response;
    } catch (error) {
      this.recordFailure(toolName, params, error, startedAt, traceId);
      throw this.wrapError(error, toolName);
    }
  }

  private generateTraceId(startedAt: number): string {
    return `tr_${startedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private validateAndPrepare(
    toolName: string,
    rawParams: unknown,
    meta: ToolMeta,
  ): Record<string, unknown> {
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
    this.prerequisiteChecker?.check(toolName, meta.prerequisites);
    return validated.value;
  }

  private async loadHandler(
    toolName: string,
    meta: ToolMeta,
  ): Promise<LoadedHandler> {
    const handler = await this.loader.load(meta);
    if (!handler) {
      throw createToolError(
        ErrorCodes.NOT_FOUND,
        `Tool handler 未找到: ${toolName}`,
        {toolName},
      );
    }
    return handler;
  }

  private async processRequest(
    meta: ToolMeta,
    handler: LoadedHandler,
    params: Record<string, unknown>,
    toolName: string,
  ): Promise<unknown> {
    const rawResult = await this.router.execute(meta, handler, params);
    const normalized = this.processor.normalize(rawResult);
    this.contextGuard?.recordCall(toolName);
    const enriched =
      this.contextGuard?.enrichResponse(toolName, normalized) ?? normalized;
    return this.processor.process(enriched);
  }

  private recordSuccess(
    toolName: string,
    params: Record<string, unknown> | undefined,
    response: unknown,
    startedAt: number,
    traceId: string,
  ): void {
    const durationMs = Date.now() - startedAt;
    this.telemetry.success(toolName, params ?? {}, response, durationMs, traceId);
    this.resultRecorder.record({
      toolName,
      traceId,
      success: true,
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      input: params,
      request: params,
      response,
    });
  }

  private recordFailure(
    toolName: string,
    params: Record<string, unknown> | undefined,
    error: unknown,
    startedAt: number,
    traceId: string,
  ): void {
    const toolError = this.wrapError(error, toolName);
    const durationMs = Date.now() - startedAt;
    this.telemetry.failure(toolName, toolError, durationMs, traceId);
    this.resultRecorder.record({
      toolName,
      traceId,
      success: false,
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      input: params,
      request: params,
      error: {code: toolError.code, message: toolError.message},
    });
  }

  private wrapError(error: unknown, toolName: string): ToolError {
    return error instanceof ToolError
      ? error
      : createToolError(
          ErrorCodes.RUNTIME,
          error instanceof Error ? error.message : String(error),
          {toolName},
        );
  }
}
