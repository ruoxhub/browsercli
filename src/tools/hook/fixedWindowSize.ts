/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * 固定窗口尺寸：拦截 window.innerHeight/innerWidth/outerHeight/outerWidth 的读取和设置。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param innerHeight - 固定的 innerHeight 值，默认 660
 * @param innerWidth - 固定的 innerWidth 值，默认 1366
 * @param outerHeight - 固定的 outerHeight 值，默认 760
 * @param outerWidth - 固定的 outerWidth 值，默认 1400
 * @returns 结构化结果对象
 */
export async function fixedWindowSize(
  frame: Frame,
  innerHeight?: number,
  innerWidth?: number,
  outerHeight?: number,
  outerWidth?: number,
): Promise<HookResult> {
  const fixedInnerH = innerHeight ?? 660;
  const fixedInnerW = innerWidth ?? 1366;
  const fixedOuterH = outerHeight ?? 760;
  const fixedOuterW = outerWidth ?? 1400;

  const hookCode = `
(function() {
  'use strict';
  const fixedInnerH = ${fixedInnerH};
  const fixedInnerW = ${fixedInnerW};
  const fixedOuterH = ${fixedOuterH};
  const fixedOuterW = ${fixedOuterW};
${buildHookStoreRuntime({
  hookId: 'fixed_window_size',
  type: 'window',
  target: 'window.size',
})}

  // innerHeight
  const innerHeightDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const innerHeightSet = innerHeightDesc ? innerHeightDesc.set : undefined;
  Object.defineProperty(window, 'innerHeight', {
    get: function() {
      __pushHookRecord({event: 'get', property: 'innerHeight', value: fixedInnerH});
      return fixedInnerH;
    },
    set: function(v) {
      __pushHookRecord({event: 'set', property: 'innerHeight', value: __cloneHookValue(v), appliedValue: fixedInnerH});
      if (innerHeightSet) innerHeightSet.call(window, fixedInnerH);
    },
    configurable: true
  });

  // innerWidth
  const innerWidthDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const innerWidthSet = innerWidthDesc ? innerWidthDesc.set : undefined;
  Object.defineProperty(window, 'innerWidth', {
    get: function() {
      __pushHookRecord({event: 'get', property: 'innerWidth', value: fixedInnerW});
      return fixedInnerW;
    },
    set: function(v) {
      __pushHookRecord({event: 'set', property: 'innerWidth', value: __cloneHookValue(v), appliedValue: fixedInnerW});
      if (innerWidthSet) innerWidthSet.call(window, fixedInnerW);
    },
    configurable: true
  });

  // outerHeight
  const outerHeightDesc = Object.getOwnPropertyDescriptor(window, 'outerHeight');
  const outerHeightSet = outerHeightDesc ? outerHeightDesc.set : undefined;
  Object.defineProperty(window, 'outerHeight', {
    get: function() {
      __pushHookRecord({event: 'get', property: 'outerHeight', value: fixedOuterH});
      return fixedOuterH;
    },
    set: function(v) {
      __pushHookRecord({event: 'set', property: 'outerHeight', value: __cloneHookValue(v), appliedValue: fixedOuterH});
      if (outerHeightSet) outerHeightSet.call(window, fixedOuterH);
    },
    configurable: true
  });

  // outerWidth
  const outerWidthDesc = Object.getOwnPropertyDescriptor(window, 'outerWidth');
  const outerWidthSet = outerWidthDesc ? outerWidthDesc.set : undefined;
  Object.defineProperty(window, 'outerWidth', {
    get: function() {
      __pushHookRecord({event: 'get', property: 'outerWidth', value: fixedOuterW});
      return fixedOuterW;
    },
    set: function(v) {
      __pushHookRecord({event: 'set', property: 'outerWidth', value: __cloneHookValue(v), appliedValue: fixedOuterW});
      if (outerWidthSet) outerWidthSet.call(window, fixedOuterW);
    },
    configurable: true
  });

  console.log('[fixed_window_size] ✅ Window size fixed: inner=' + fixedInnerW + 'x' + fixedInnerH + ', outer=' + fixedOuterW + 'x' + fixedOuterH);
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: `窗口尺寸 Hook 已安装，innerHeight=${fixedInnerH}, innerWidth=${fixedInnerW}, outerHeight=${fixedOuterH}, outerWidth=${fixedOuterW}`,
      tooltype: 'fixed_window_size',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'fixed_window_size',
    };
  }
}
