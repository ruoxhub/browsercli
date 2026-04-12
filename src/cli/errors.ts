/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
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
      'Check daemon status with "js-reverse status"',
      'Ensure browser is running with --remote-debugging-port=9222',
    ]);
  }
  return new AxiError(String(error), fallbackCode);
}

export function daemonError(action: string, details?: string): AxiError {
  const suggestions = [
    'Run "js-reverse start" to launch the daemon',
    'Check daemon logs for more details',
  ];
  if (details) suggestions.unshift(details);
  return new AxiError(
    `Failed to ${action}: daemon unavailable`,
    'DAEMON_ERROR',
    suggestions,
  );
}

export function toolError(tool: string, reason: string): AxiError {
  return new AxiError(`Tool "${tool}" failed: ${reason}`, 'TOOL_ERROR', [
    'Verify the daemon is running',
    'Check tool parameters are valid',
  ]);
}
