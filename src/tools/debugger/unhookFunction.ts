/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {UnhookFunctionResult} from './types.js';

/**
 * 移除已安装的函数 Hook，恢复原始函数。
 *
 * @param frame - Puppeteer Frame 对象
 * @param hookId - 要移除的 Hook ID
 * @returns 结构化结果对象
 */
export async function unhookFunction(
  frame: Frame,
  hookId: string,
): Promise<UnhookFunctionResult> {
  const unhookCode = `
(function() {
  const hookId = ${JSON.stringify(hookId)};
  if (!window.__mcp_hooks__ || !window.__mcp_hooks__[hookId]) {
    return { success: false, message: 'Hook not found: ' + hookId };
  }

  const { obj, methodName, original } = window.__mcp_hooks__[hookId];
  obj[methodName] = original;
  delete window.__mcp_hooks__[hookId];

  return { success: true };
})();
`;

  try {
    const result = await frame.evaluate(unhookCode);

    if (result && typeof result === 'object') {
      const r = result as {success: boolean; message?: string};
      if (r.success) {
        return {
          success: true,
          message: `Hook "${hookId}" 已移除`,
          tooltype: 'unhook_function',
        };
      }
      return {
        success: false,
        message: r.message || `Hook 未找到：${hookId}`,
        tooltype: 'unhook_function',
      };
    }
    return {
      success: false,
      message: `移除 Hook 返回异常：${hookId}`,
      tooltype: 'unhook_function',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'unhook_function',
    };
  }
}
