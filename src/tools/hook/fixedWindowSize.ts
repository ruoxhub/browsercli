/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * 固定窗口尺寸：拦截 window.innerHeight/innerWidth/outerHeight/outerWidth 的读取和设置。
 */
export const fixedWindowSize = defineTool({
  name: 'fixed_window_size',
  description:
    'Fix window dimensions by intercepting innerHeight/innerWidth/outerHeight/outerWidth getters and setters.',
  annotations: {
    title: 'Fixed Window Size',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    innerHeight: zod
      .number()
      .optional()
      .describe('Fixed innerHeight, default 660'),
    innerWidth: zod
      .number()
      .optional()
      .describe('Fixed innerWidth, default 1366'),
    outerHeight: zod
      .number()
      .optional()
      .describe('Fixed outerHeight, default 760'),
    outerWidth: zod
      .number()
      .optional()
      .describe('Fixed outerWidth, default 1400'),
  },
  handler: async (request, response, context) => {
    const {innerHeight, innerWidth, outerHeight, outerWidth} = request.params;
    const fixedInnerH = innerHeight ?? 660;
    const fixedInnerW = innerWidth ?? 1366;
    const fixedOuterH = outerHeight ?? 760;
    const fixedOuterW = outerWidth ?? 1400;
    const frame = (context as Context).getSelectedFrame();

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
      getRuntime().hookManager.registerHook({
        hookId: 'fixed_window_size',
        type: 'window',
        description: `Fixed Window Size (${fixedInnerW}x${fixedInnerH})`,
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: `窗口尺寸 Hook 已安装，innerHeight=${fixedInnerH}, innerWidth=${fixedInnerW}, outerHeight=${fixedOuterH}, outerWidth=${fixedOuterW}`,
        tooltype: 'fixed_window_size',
        data: {
          hookId: 'fixed_window_size',
          innerHeight: fixedInnerH,
          innerWidth: fixedInnerW,
          outerHeight: fixedOuterH,
          outerWidth: fixedOuterW,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'fixed_window_size',
        data: { hookId: 'fixed_window_size' },
      });
    }
  },
});
