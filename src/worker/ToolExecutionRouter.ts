/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from 'patchright';

import type {ToolMeta} from '../cli/tools-meta.js';
import type {Response, ToolDefinition} from '../tools/ToolDefinition.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import type {DefineToolContextFactory} from './DefineToolContextFactory.js';
import type {ToolContextProvider} from './ToolContextProvider.js';
import type {LoadedHandler} from './ToolHandlerLoader.js';
import {ToolResponseAccumulator} from './ToolResponseAccumulator.js';

const FRAME_EVALUATE_TIMEOUT = 10_000;

export function wrapFrameWithTimeout(
  frame: Frame,
  timeoutMs: number = FRAME_EVALUATE_TIMEOUT,
): Frame {
  return new Proxy(frame, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'evaluate') {
        return function evaluateWithTimeout(this: unknown, ...args: unknown[]) {
          const evalPromise = (value as Function).apply(target, args);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `frame.evaluate() 超时 (${timeoutMs}ms)，可能调试器已暂停`,
                  ),
                ),
              timeoutMs,
            ),
          );
          return Promise.race([evalPromise, timeoutPromise]);
        };
      }
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

export class ToolExecutionRouter {
  constructor(
    private readonly contextProvider: ToolContextProvider,
    private readonly defineToolContextFactory: DefineToolContextFactory,
  ) {}

  async execute(
    meta: ToolMeta,
    handler: LoadedHandler,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.isToolDefinition(handler) || meta.callMode === 'defineTool') {
      if (!this.isToolDefinition(handler)) {
        throw createToolError(
          ErrorCodes.RUNTIME,
          `Tool "${meta.name}" marked as defineTool but handler is not a ToolDefinition`,
          {toolName: meta.name},
        );
      }

      const accumulator = new ToolResponseAccumulator();
      await handler.handler(
        {params},
        accumulator as Response,
        this.defineToolContextFactory.create(),
      );
      return accumulator.toJSON();
    }

    if (meta.callMode === ('frame' as ToolMeta['callMode'])) {
      const frame =
        this.contextProvider.getSelectedFrame() ??
        this.contextProvider.getSelectedPage()?.mainFrame() ??
        null;
      if (!frame) {
        throw createToolError(
          ErrorCodes.CONNECTION,
          `Tool "${meta.name}" 需要页面上下文，但当前没有可用页面`,
          {toolName: meta.name},
        );
      }
      return handler(wrapFrameWithTimeout(frame), params);
    }

    if (meta.callMode === ('context' as ToolMeta['callMode'])) {
      return handler(this.contextProvider, params);
    }

    return handler(params);
  }

  private isToolDefinition(handler: LoadedHandler): handler is ToolDefinition {
    return (
      typeof handler === 'object' &&
      handler !== null &&
      typeof handler.handler === 'function'
    );
  }
}
