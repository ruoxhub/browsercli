/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export interface ErrorResponse {
  code: string;
  type: string;
  message: string;
  context?: Record<string, unknown>;
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

  // Script locator resolution（spec §4 错误分类）
  SCRIPT_NOT_FOUND: 'SCRIPT_NOT_FOUND',
  SCRIPT_LOCATOR_AMBIGUOUS: 'SCRIPT_LOCATOR_AMBIGUOUS',
  PAGE_NOT_FOUND: 'PAGE_NOT_FOUND',
  SCRIPT_ID_STALE: 'SCRIPT_ID_STALE',

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

const NON_RECOVERABLE_CODES = new Set<ToolErrorCode>([
  ErrorCodes.PERMISSION,
  ErrorCodes.NOT_FOUND,
]);

export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly recoverable = !NON_RECOVERABLE_CODES.has(code),
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function createToolError(
  code: ToolErrorCode,
  message: string,
  context?: Record<string, unknown>,
): ToolError {
  return new ToolError(code, message, context);
}

export function formatError(
  error: unknown,
  code: string = ErrorCodes.RUNTIME,
  context?: Record<string, unknown>,
): ErrorResponse {
  if (error instanceof ToolError) {
    return {
      code: error.code,
      type: error.name,
      message: error.message,
      context: context ?? error.context,
      recoverable: error.recoverable,
    };
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
