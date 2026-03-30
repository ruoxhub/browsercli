/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from '../categories.js';
import { defineTool, type Context, type Response } from '../ToolDefinition.js';

export type AntiAntiDebugFeature =
  | 'fixedWindowSize'
  | 'fixedTime'
  | 'preventClose'
  | 'preventHistoryBack'
  | 'preventConsoleClear';

const FEATURE_DESCRIPTIONS: Record<AntiAntiDebugFeature, string> = {
  fixedWindowSize: '固定浏览器窗口尺寸，绕过 DevTools 检测',
  fixedTime: '固定 Date.now() 和 performance.now() 返回值',
  preventClose: '阻止 window.close() 关闭页面',
  preventHistoryBack: '阻止 history.back/go() 返回上一页',
  preventConsoleClear: '阻止 console.clear() 清除控制台',
};

export const antiAntiDebug = defineTool({
  name: 'anti_anti_debug',
  description: '反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除',
  annotations: {
    title: 'Anti-Anti-Debug',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    features: zod
      .array(zod.enum(['fixedWindowSize', 'fixedTime', 'preventClose', 'preventHistoryBack', 'preventConsoleClear']))
      .describe('要启用的功能'),
  },
  handler: async (request: { params: { features: AntiAntiDebugFeature[] } }, response: Response, context: Context) => {
    const features = request.params.features;

    const hookCodes: string[] = [];
    const installedFeatures: string[] = [];

    // Fixed Window Size
    if (features.includes('fixedWindowSize')) {
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
    if (features.includes('fixedTime')) {
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
    if (features.includes('preventClose')) {
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
    if (features.includes('preventHistoryBack')) {
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
    if (features.includes('preventConsoleClear')) {
      hookCodes.push(`
(function() {
  'use strict';
  console.clear = function() {
    console.log('[anti_anti_debug] ⛔ Blocked: console.clear()');
  };
  console.log('[anti_anti_debug] ✅ Blocked console.clear');
})();
`);
      installedFeatures.push('preventConsoleClear');
    }

    // Combine all hooks
    const combinedCode = hookCodes.join('\n');

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(combinedCode);

      response.appendResponseLine('✅ Anti-Anti-Debug 已安装');
      response.appendResponseLine(`- 启用功能：${installedFeatures.length}`);
      response.appendResponseLine('');

      for (const feature of installedFeatures as AntiAntiDebugFeature[]) {
        response.appendResponseLine(`- ${FEATURE_DESCRIPTIONS[feature]}`);
      }
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
