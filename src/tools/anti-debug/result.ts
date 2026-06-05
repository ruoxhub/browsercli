/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Response} from '../ToolDefinition.js';
import type {HookResult} from './types.js';

/** 从任意 unknown 中提取安全的错误消息 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 包装一个异步工具调用，统一处理成功 / 失败结构化响应。
 *
 * 行为契约：与早期手写 try/catch 完全一致 —— 只调用 `setStructuredContent`，
 * 不会向响应行写入 JSON 文本。
 */
export async function runHook(
  response: Response,
  tooltype: string,
  action: () => Promise<string>,
): Promise<void> {
  try {
    const message = await action();
    response.setStructuredContent({
      success: true,
      message,
      tooltype,
      data: null,
    } satisfies HookResult);
  } catch (error) {
    response.setStructuredContent({
      success: false,
      message: `错误：${getErrorMessage(error)}`,
      tooltype,
      data: null,
    } satisfies HookResult);
  }
}
