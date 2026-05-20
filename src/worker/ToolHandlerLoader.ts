/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ToolMeta} from '../cli/tools-meta.js';
import type {ToolDefinition} from '../tools/ToolDefinition.js';

export type LoadedHandler =
  | ((...args: unknown[]) => Promise<unknown>)
  | ToolDefinition;

export class ToolHandlerLoader {
  private readonly loadedHandlers = new Map<string, LoadedHandler>();

  async load(meta: ToolMeta): Promise<LoadedHandler | null> {
    const cacheKey = `${meta.modulePath}:${meta.handlerName}`;
    const cached = this.loadedHandlers.get(cacheKey);
    if (cached) return cached;

    try {
      const modulePath = `../tools${meta.modulePath.replace(/^\./, '')}`;
      const module = await import(modulePath);
      const handler = module[meta.handlerName];

      if (typeof handler === 'function' || this.isToolDefinition(handler)) {
        this.loadedHandlers.set(cacheKey, handler);
        return handler;
      }

      console.warn(
        `[ToolHandlerLoader] ${cacheKey} handler 不是函数也不是 ToolDefinition`,
      );
      return null;
    } catch (error) {
      console.warn(
        `[ToolHandlerLoader] 加载 ${cacheKey} 失败: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  private isToolDefinition(value: unknown): value is ToolDefinition {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as ToolDefinition).handler === 'function'
    );
  }
}
