/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

export type TraceOutputMode = 'errors' | 'all';

export function resolveTraceOutputMode(
  globalMode: string | undefined,
  requestMode: unknown,
): TraceOutputMode {
  if (requestMode === 'all' || requestMode === 'errors') {
    return requestMode;
  }
  return globalMode === 'all' ? 'all' : 'errors';
}

export function withOptionalTraceIdContent(
  content: Array<{type: string; text?: string}>,
  traceId: string,
  mode: string | undefined,
): Array<{type: string; text?: string}> {
  if (mode !== 'all') {
    return content;
  }
  return [{type: 'text', text: JSON.stringify({traceId}, null, 2)}, ...content];
}
