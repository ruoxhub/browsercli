/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 执行上下文类型与纯函数。
 *
 * 从 tools/debugger/executionContexts.ts 提取至 modules 层，使 DebuggerManager
 * 及其策略模块（ExecutionContextTracker 等）可在不反向依赖 tools 层的前提下
 * 复用 world 分类逻辑。tools/debugger/executionContexts.ts 现仅作 re-export
 * 兼容层。
 */

export type ExecutionContextWorld = 'page' | 'content-script' | 'unknown';

export interface RawExecutionContextDescription {
  id: number;
  origin?: string;
  name?: string;
  auxData?: {
    frameId?: string;
    type?: string;
    isDefault?: boolean;
  };
}

export interface ExecutionContextInfo {
  id: number;
  frameId?: string;
  origin: string;
  name: string;
  world: ExecutionContextWorld;
  extensionId?: string;
}

const EXTENSION_PREFIX = 'chrome-extension://';

export function extractExtensionId(value?: string): string | undefined {
  if (!value?.startsWith(EXTENSION_PREFIX)) {
    return undefined;
  }

  const rest = value.slice(EXTENSION_PREFIX.length);
  const slashIndex = rest.indexOf('/');
  return slashIndex === -1 ? rest || undefined : rest.slice(0, slashIndex);
}

export function classifyExecutionContextWorld(
  context: RawExecutionContextDescription,
): ExecutionContextWorld {
  if (context.auxData?.isDefault || context.auxData?.type === 'default') {
    return 'page';
  }

  if (extractExtensionId(context.origin)) {
    return 'content-script';
  }

  if (context.auxData?.type === 'isolated') {
    return 'content-script';
  }

  return 'unknown';
}

export function createExecutionContextInfo(
  context: RawExecutionContextDescription,
): ExecutionContextInfo {
  const originExt = extractExtensionId(context.origin);
  return {
    id: context.id,
    frameId: context.auxData?.frameId,
    origin: context.origin ?? '',
    name: context.name ?? '',
    world: classifyExecutionContextWorld(context),
    extensionId: originExt ?? extractExtensionId(context.name),
  };
}
