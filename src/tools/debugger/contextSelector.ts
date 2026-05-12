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
  /**
   * 当 frameId 缺失且 world 内有多个候选时，是否回退到"第一个匹配"。
   * 默认 false（严格行为，原有逻辑）。调用方明确开启后可用于消除
   * 多 iframe 场景下的歧义报错。
   */
  fallbackToFirst?: boolean;
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
    if (frameMatches.length === 1) {
      return frameMatches[0] ?? null;
    }
    if (frameMatches.length > 1 && params.fallbackToFirst) {
      return frameMatches[0] ?? null;
    }
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }
  return params.fallbackToFirst ? (candidates[0] ?? null) : null;
}
