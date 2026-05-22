/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import type {AntiAntiDebugFeature} from './types.js';

const antiAntiDebugFeatureSchema = zod.enum([
  'fixedWindowSize',
  'fixedTime',
  'preventClose',
  'preventHistoryBack',
  'preventConsoleClear',
  'hideWebdriver',
]);

/**
 * 反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除。
 */
export const antiAntiDebug = defineTool({
  name: 'anti_anti_debug',
  description:
    'Anti-anti-debug toolkit: fix window size, freeze time, block page close, block history navigation, block console clear, hide webdriver flag.',
  annotations: {
    title: 'Anti Anti-Debug',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    features: zod
      .array(antiAntiDebugFeatureSchema)
      .min(1)
      .describe(
        'Features to enable. Options: fixedWindowSize, fixedTime, preventClose, preventHistoryBack, preventConsoleClear, hideWebdriver',
      ),
  },
  handler: async (request, response, context) => {
    const {features} = request.params;
    const safeFeatures: AntiAntiDebugFeature[] = Array.isArray(features)
      ? features
      : [];

    if (safeFeatures.length === 0) {
      const result = {
        success: false,
        message:
          'anti_anti_debug requires a non-empty "features" array (e.g. ["fixedWindowSize", "hideWebdriver"])',
        tooltype: 'anti_anti_debug',
      };
      // response.appendResponseLine('```json');
      // response.appendResponseLine(JSON.stringify(result, null, 2));
      // response.appendResponseLine('```');
      response.setStructuredContent(result);
      return;
    }

    const frame = (context as Context).getSelectedFrame();
    const hookCodes: string[] = [];
    const installedFeatures: string[] = [];

    // Fixed Window Size
    if (safeFeatures.includes('fixedWindowSize')) {
      hookCodes.push(`
(function() {
  'use strict';
  Object.defineProperties(window, {
    innerWidth: { value: 1366, writable: false, configurable: true },
    innerHeight: { value: 660, writable: false, configurable: true },
    outerWidth: { value: 1400, writable: false, configurable: true },
    outerHeight: { value: 760, writable: false, configurable: true },
  });
  console.log('[anti_anti_debug] ✅ Fixed window size');
})();
`);
      installedFeatures.push('fixedWindowSize');
    }

    // Fixed Time
    if (safeFeatures.includes('fixedTime')) {
      hookCodes.push(`
(function() {
  'use strict';
  const originalDateNow = Date.now;
  const originalPerformanceNow = performance.now;

  Date.now = () => 0;
  console.log('[anti_anti_debug] ✅ Fixed Date.now()');

  if (typeof performance !== 'undefined' && performance.now) {
    performance.now = () => 0;
    console.log('[anti_anti_debug] ✅ Fixed performance.now()');
  }
})();
`);
      installedFeatures.push('fixedTime');
    }

    // Prevent Close
    if (safeFeatures.includes('preventClose')) {
      hookCodes.push(`
(function() {
  'use strict';
  window.close = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: window.close()');
  };
  console.log('[anti_anti_debug] ✅ Blocked window.close');
})();
`);
      installedFeatures.push('preventClose');
    }

    // Prevent History Back
    if (safeFeatures.includes('preventHistoryBack')) {
      hookCodes.push(`
(function() {
  'use strict';
  const originalHistory = window.history;

  originalHistory.back = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: history.back()');
  };

  originalHistory.go = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: history.go()');
  };

  console.log('[anti_anti_debug] ✅ Blocked history navigation');
})();
`);
      installedFeatures.push('preventHistoryBack');
    }

    // Prevent Console Clear
    if (safeFeatures.includes('preventConsoleClear')) {
      hookCodes.push(`
(function() {
  'use strict';
  const origClear = console.clear;
  console.clear = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: console.clear()');
  };
  console.log('[anti_anti_debug] ✅ Blocked console.clear');
})();
`);
      installedFeatures.push('preventConsoleClear');
    }

    // Hide Webdriver
    if (safeFeatures.includes('hideWebdriver')) {
      hookCodes.push(`
(function() {
  'use strict';
  if (navigator.webdriver !== undefined) {
    Object.defineProperty(navigator, 'webdriver', {
      get: function() { return false; },
      configurable: true
    });
    console.log('[anti_anti_debug] ✅ Hidden navigator.webdriver');
  }
})();
`);
      installedFeatures.push('hideWebdriver');
    }

    // Combine all hooks
    const combinedCode = hookCodes.join('\n');

    try {
      await frame.evaluate(combinedCode);
      const result = {
        success: true,
        message: `Anti-Anti-Debug 已安装，启用功能：${installedFeatures.join(', ')}（共 ${installedFeatures.length} 项）`,
        tooltype: 'anti_anti_debug',
      };

      response.setStructuredContent(result);
    } catch (error) {
      const result = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'anti_anti_debug',
      };

      response.setStructuredContent(result);
    }
  },
});
