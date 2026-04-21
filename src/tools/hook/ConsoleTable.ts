/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * Hook console.table：绕过通过 console.table 检测运行时间差的反调试。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param enabled - 是否启用，默认 true
 * @returns 结构化结果对象
 */
export async function hookConsoleTable(
  frame: Frame,
  enabled?: boolean,
): Promise<HookResult> {
  const isEnabled = enabled !== false;

  const hookCode = `
(function() {
  'use strict';
${
  isEnabled
    ? `  console.table = function() {};
  console.log('[hook_console_table] ✅ console.table neutralized (anti-time-difference-debug)');`
    : `  console.log('[hook_console_table] ⚠️ hook disabled');`
}
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: isEnabled
        ? 'Console Table Hook 已安装，console.table 已被置空，时间差检测将失效'
        : 'Console Table Hook 已禁用（enabled=false）',
      tooltype: 'hook_console_table',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_console_table',
    };
  }
}
