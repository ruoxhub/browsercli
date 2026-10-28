/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {getErrorMessage} from '../shared/pageResponse.js';
import type {Response} from '../ToolDefinition.js';

import type {HookResult} from './types.js';

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
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw createToolError(
      ErrorCodes.RUNTIME,
      `错误：${getErrorMessage(error)}`,
      {toolName: tooltype},
    );
  }
}
