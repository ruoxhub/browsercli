/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * 禁止历史导航：重写 window.history.go 和 window.history.back 方法以防止网站反调试返回上一页。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @returns 结构化结果对象
 */
export async function hookHistoryGo(frame: Frame): Promise<HookResult> {
  const hookCode = `(function() {
  'use strict';
  window.history.go = function() {};
  window.history.back = function() {};
})();`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'history.go 和 history.back 已拦截',
      tooltype: 'hook_history_go',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_history_go',
    };
  }
}
