/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {HookResult, AntiAntiDebugFeature} from './types.js';

/**
 * 反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param features - 要启用的功能列表
 * @returns 结构化结果对象
 */
export async function antiAntiDebug(
  frame: Frame,
  features: AntiAntiDebugFeature[],
): Promise<HookResult> {
  const safeFeatures = Array.isArray(features) ? features : [];

  if (safeFeatures.length === 0) {
    return {
      success: false,
      message: 'anti_anti_debug requires a non-empty "features" array (e.g. ["fixedWindowSize", "hideWebdriver"])',
      tooltype: 'anti_anti_debug',
    };
  }

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
    return {
      success: true,
      message: `Anti-Anti-Debug 已安装，启用功能：${installedFeatures.length}`,
      tooltype: 'anti_anti_debug',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'anti_anti_debug',
    };
  }
}
