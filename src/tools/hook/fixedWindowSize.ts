/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const fixedWindowSize = defineTool({
  name: 'fixed_window_size',
  description:
    '固定窗口尺寸：拦截 window.innerHeight/innerWidth/outerHeight/outerWidth 的读取和设置',
  annotations: {
    title: 'Fixed Window Size',
    category: ToolCategory.HOOK,
    readOnlyHint: false,
  },
  schema: {
    innerHeight: zod
      .number()
      .optional()
      .default(660)
      .describe('固定的 innerHeight 值'),
    innerWidth: zod
      .number()
      .optional()
      .default(1366)
      .describe('固定的 innerWidth 值'),
    outerHeight: zod
      .number()
      .optional()
      .default(760)
      .describe('固定的 outerHeight 值'),
    outerWidth: zod
      .number()
      .optional()
      .default(1400)
      .describe('固定的 outerWidth 值'),
  },
  handler: async (
    request: {
      params: {
        innerHeight?: number;
        innerWidth?: number;
        outerHeight?: number;
        outerWidth?: number;
      };
    },
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const {innerHeight, innerWidth, outerHeight, outerWidth} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const fixedInnerH = ${innerHeight};
  const fixedInnerW = ${innerWidth};
  const fixedOuterH = ${outerHeight};
  const fixedOuterW = ${outerWidth};

  // innerHeight
  const innerHeightDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const innerHeightSet = innerHeightDesc ? innerHeightDesc.set : undefined;
  Object.defineProperty(window, 'innerHeight', {
    get: function() { return fixedInnerH; },
    set: function(v) {
      if (innerHeightSet) innerHeightSet.call(window, fixedInnerH);
    },
    configurable: true
  });

  // innerWidth
  const innerWidthDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const innerWidthSet = innerWidthDesc ? innerWidthDesc.set : undefined;
  Object.defineProperty(window, 'innerWidth', {
    get: function() { return fixedInnerW; },
    set: function(v) {
      if (innerWidthSet) innerWidthSet.call(window, fixedInnerW);
    },
    configurable: true
  });

  // outerHeight
  const outerHeightDesc = Object.getOwnPropertyDescriptor(window, 'outerHeight');
  const outerHeightSet = outerHeightDesc ? outerHeightDesc.set : undefined;
  Object.defineProperty(window, 'outerHeight', {
    get: function() { return fixedOuterH; },
    set: function(v) {
      if (outerHeightSet) outerHeightSet.call(window, fixedOuterH);
    },
    configurable: true
  });

  // outerWidth
  const outerWidthDesc = Object.getOwnPropertyDescriptor(window, 'outerWidth');
  const outerWidthSet = outerWidthDesc ? outerWidthDesc.set : undefined;
  Object.defineProperty(window, 'outerWidth', {
    get: function() { return fixedOuterW; },
    set: function(v) {
      if (outerWidthSet) outerWidthSet.call(window, fixedOuterW);
    },
    configurable: true
  });

  console.log('[fixed_window_size] ✅ Window size fixed: inner=' + fixedInnerW + 'x' + fixedInnerH + ', outer=' + fixedOuterW + 'x' + fixedOuterH);
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ 窗口尺寸 Hook 已安装');
      response.appendResponseLine(
        `- innerHeight=${innerHeight}, innerWidth=${innerWidth}`,
      );
      response.appendResponseLine(
        `- outerHeight=${outerHeight}, outerWidth=${outerWidth}`,
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
