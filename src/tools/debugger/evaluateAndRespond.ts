/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {createToolError, ErrorCodes, ToolError} from '../../utils/errors.js';
import {type Context, type Response} from '../ToolDefinition.js';

/**
 * 获取当前选中的 Frame，若不存在则抛出 ToolError。
 */
export function getFrameOrRespond(
  context: Context,
  _response: Response,
  tooltype: string,
): Frame {
  const frame = context.getSelectedFrame();
  if (!frame) {
    throw createToolError(
      ErrorCodes.FRAME_REQUIRED,
      '当前没有可用的页面或 Frame',
      {toolName: tooltype},
    );
  }
  return frame;
}

/**
 * Debugger 工具公共执行流程：获取 Frame → 执行页面代码 → 分发结果 → 异常兜底。
 *
 * 消除了以下重复模式：
 * 1. Frame 空值守卫（6 行 × 6 个工具）
 * 2. try/catch 错误包装（7 行 × 6 个工具）
 * 3. result 类型检查与成功/失败分发（12 行 × 5 个工具）
 */
export async function evaluateAndRespond<T>(options: {
  context: Context;
  response: Response;
  tooltype: string;
  evaluate: (frame: Frame) => Promise<T>;
  onSuccess: (result: T) => void;
  onEvaluateFail: (result: T) => void;
}): Promise<void> {
  const {context, response, tooltype, evaluate, onSuccess, onEvaluateFail} =
    options;

  const frame = getFrameOrRespond(context, response, tooltype);

  try {
    const result = await evaluate(frame);

    if (result !== null && typeof result === 'object') {
      const typed = result as Record<string, unknown>;
      if (typed.error) {
        throw createToolError(
          ErrorCodes.RUNTIME,
          String(typed.error) || '操作失败',
          {toolName: tooltype},
        );
      }
      onSuccess(result);
    } else {
      onEvaluateFail(result);
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw createToolError(
      ErrorCodes.RUNTIME,
      `错误：${error instanceof Error ? error.message : String(error)}`,
      {toolName: tooltype},
    );
  }
}
