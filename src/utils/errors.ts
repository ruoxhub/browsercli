/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ToolRecovery {
  tool?: string;
  command?: string;
  reason: string;
}

export interface ToolErrorOptions {
  retryable?: boolean;
  recovery?: ToolRecovery;
  details?: Record<string, unknown>;
}

export interface ErrorResponse {
  code: string;
  type: string;
  message: string;
  context?: Record<string, unknown>;
  retryable?: boolean;
  recovery?: ToolRecovery;
  details?: Record<string, unknown>;
  /** @deprecated Use retryable instead */
  recoverable?: boolean;
}

export const ErrorCodes = {
  PREREQUISITE: 'PREREQUISITE',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  CONNECTION: 'CONNECTION',
  RUNTIME: 'RUNTIME',
  PERMISSION: 'PERMISSION',

  // Canonical prerequisite & state error codes
  BROWSER_REQUIRED: 'BROWSER_REQUIRED',
  PAGE_REQUIRED: 'PAGE_REQUIRED',
  FRAME_REQUIRED: 'FRAME_REQUIRED',
  DEBUGGER_PAUSED: 'DEBUGGER_PAUSED',
  DEBUGGER_NOT_PAUSED: 'DEBUGGER_NOT_PAUSED',
  NATIVE_TOOL_MISSING: 'NATIVE_TOOL_MISSING',
  AI_REQUIRED: 'AI_REQUIRED',

  // Script locator resolution（spec §4 错误分类）
  SCRIPT_NOT_FOUND: 'SCRIPT_NOT_FOUND',
  SCRIPT_LOCATOR_AMBIGUOUS: 'SCRIPT_LOCATOR_AMBIGUOUS',
  ELEMENT_LOCATOR_AMBIGUOUS: 'ELEMENT_LOCATOR_AMBIGUOUS',
  PAGE_NOT_FOUND: 'PAGE_NOT_FOUND',
  SCRIPT_ID_STALE: 'SCRIPT_ID_STALE',
  PAGE_UNRESPONSIVE: 'PAGE_UNRESPONSIVE',

  // 源码落盘完整性（spec §4）
  SOURCE_INTEGRITY_MISMATCH: 'SOURCE_INTEGRITY_MISMATCH',
  SOURCE_WRITE_FAILED: 'SOURCE_WRITE_FAILED',

  TOOL_EXECUTION_ERROR: 'RUNTIME',
  VALIDATION_ERROR: 'VALIDATION',
  AI_PROVIDER_ERROR: 'RUNTIME',
  BROWSER_ERROR: 'CONNECTION',
  INTERNAL_ERROR: 'RUNTIME',
} as const;

export const LegacyErrorCodeMap = {
  TOOL_EXECUTION_ERROR: ErrorCodes.RUNTIME,
  VALIDATION_ERROR: ErrorCodes.VALIDATION,
  AI_PROVIDER_ERROR: ErrorCodes.RUNTIME,
  BROWSER_ERROR: ErrorCodes.CONNECTION,
  INTERNAL_ERROR: ErrorCodes.RUNTIME,
} as const;

export type ToolErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const NON_RETRYABLE_CODES = new Set<string>([
  ErrorCodes.VALIDATION,
  ErrorCodes.NOT_FOUND,
  ErrorCodes.PERMISSION,
  ErrorCodes.NATIVE_TOOL_MISSING,
  ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS,
]);

export class ToolError extends Error {
  public readonly retryable: boolean;
  public readonly recovery?: ToolRecovery;
  public readonly details?: Record<string, unknown>;

  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
    options?: ToolErrorOptions | boolean,
  ) {
    super(message);
    this.name = 'ToolError';
    const opts: ToolErrorOptions =
      typeof options === 'boolean' ? {retryable: options} : (options ?? {});
    this.retryable =
      opts.retryable !== undefined
        ? opts.retryable
        : !NON_RETRYABLE_CODES.has(code);
    this.recovery = opts.recovery;
    this.details = opts.details;
  }

  /** @deprecated Use retryable instead */
  get recoverable(): boolean {
    return this.retryable;
  }
}

export function createToolError(
  code: ToolErrorCode,
  message: string,
  context?: Record<string, unknown>,
  options?: ToolErrorOptions | boolean,
): ToolError {
  return new ToolError(code, message, context, options);
}

export function formatError(
  error: unknown,
  code: string = ErrorCodes.RUNTIME,
  context?: Record<string, unknown>,
): ErrorResponse {
  if (error instanceof ToolError) {
    const response: ErrorResponse = {
      code: error.code,
      type: error.name,
      message: error.message,
      context: context ?? error.context,
      retryable: error.retryable,
      recoverable: error.recoverable,
    };
    if (error.recovery !== undefined) {
      response.recovery = error.recovery;
    }
    if (error.details !== undefined) {
      response.details = error.details;
    }
    return response;
  }

  if (error instanceof Error) {
    return {
      code,
      type: error.name || 'Error',
      message: error.message,
      context,
    };
  }

  return {
    code,
    type: 'UnknownError',
    message: String(error),
    context,
  };
}
