/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExecutionContextInfo,
  ExecutionContextWorld,
} from './executionContexts.js';

type SelectableExecutionContextWorld = Exclude<ExecutionContextWorld, 'unknown'>;

export interface SelectExecutionContextParams {
  context?: SelectableExecutionContextWorld;
  frameId?: string;
  extensionId?: string;
}

export function selectExecutionContext(
  contexts: ExecutionContextInfo[],
  params: SelectExecutionContextParams = {},
): ExecutionContextInfo | null {
  const desiredWorld = params.context ?? 'page';
  let candidates = contexts.filter(
    context => context.world === desiredWorld,
  );

  if (candidates.length === 0) {
    return null;
  }

  if (params.extensionId) {
    candidates = candidates.filter(
      context => context.extensionId === params.extensionId,
    );
    if (candidates.length === 0) {
      return null;
    }
  }

  if (params.frameId) {
    const frameMatches = candidates.filter(
      context => context.frameId === params.frameId,
    );
    return frameMatches.length === 1 ? frameMatches[0] ?? null : null;
  }

  return candidates.length === 1 ? candidates[0] ?? null : null;
}
