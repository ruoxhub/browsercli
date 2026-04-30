/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * Hook location.href：阻断页面跳转，触发 debugger 以定位跳转代码位置。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param triggerDebugger - 跳转时是否触发 debugger 断点，默认 true
 * @returns 结构化结果对象
 */
export async function hookLocationHref(
  frame: Frame,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const shouldDebug = triggerDebugger !== false;

  const hookCode = `
(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_location_href',
  type: 'location',
  target: 'window.onbeforeunload',
  triggerDebugger: shouldDebug,
})}
  window.onbeforeunload = function() {
    __pushHookRecord({
      event: 'beforeunload',
      blocked: true,
      url: window.location.href,
    });
    console.log('[hook_location_href] ⛔ Page navigation blocked');
    return false;
  };
  console.log('[hook_location_href] ✅ Navigation blocker installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: `Location Href Hook 已安装，页面跳转将被阻断${shouldDebug ? '，并触发 debugger 断点' : ''}`,
      tooltype: 'hook_location_href',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_location_href',
    };
  }
}
