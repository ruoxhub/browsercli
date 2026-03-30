/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { zod } from '../../third_party/index.js';
import { ToolCategory } from '../categories.js';
import { defineTool, type Context, type Response } from '../ToolDefinition.js';

export const activateVueDevtools = defineTool({
  name: 'activate_vue_devtools',
  description: '激活 Vue Devtools：强制启用 Vue.js 开发者工具',
  annotations: {
    title: 'Activate Vue Devtools',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request: { params: Record<string, never> }, response: Response, context: Context) => {
    const hookCode = `
(function() {
  'use strict';

  // Vue 2 Devtools detection
  if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    window.__VUE_DEVTOOLS_GLOBAL_HOOK__.enabled = true;
    console.log('[activate_vue_devtools] ✅ Vue 2 Devtools activated');
    return { success: true, version: '2.x', message: 'Vue 2 Devtools activated' };
  }

  // Vue 3 Devtools detection
  const rootElement = document.querySelector('[id="app"], [data-v-app]');
  if (rootElement && rootElement.__vue_app__) {
    const app = rootElement.__vue_app__;

    // Force enable devtools
    if (app._instance) {
      app._instance.devtools = true;
    }

    // Emit devtools init event
    setTimeout(() => {
      window.postMessage({
        source: '__VUE_DEVTOOLS_GLOBAL_HOOK__',
        event: 'vue3-init',
      }, '*');
    }, 0);

    console.log('[activate_vue_devtools] ✅ Vue 3 Devtools activated');
    return { success: true, version: '3.x', message: 'Vue 3 Devtools activated' };
  }

  // Try to find Vue instance
  for (const key in window) {
    if (key.startsWith('__vue')) {
      const vueApp = window[key];
      if (vueApp && vueApp._devtools) {
        vueApp._devtools = true;
        console.log('[activate_vue_devtools] ✅ Vue Devtools activated');
        return { success: true, version: 'unknown', message: 'Vue Devtools activated' };
      }
    }
  }

  return { success: false, error: 'Vue instance not found' };
})();
`;

    try {
      const frame = context.getSelectedFrame();
      const result = await frame.evaluate(hookCode) as {
        success: boolean;
        version?: string;
        error?: string;
        message?: string;
      };

      if (!result.success) {
        response.appendResponseLine('❌ 激活失败');
        response.appendResponseLine(result.error || '未检测到 Vue 实例');
        response.appendResponseLine('');
        response.appendResponseLine('提示：请确保页面已加载 Vue 框架后再执行此工具。');
        return;
      }

      response.appendResponseLine('✅ Vue Devtools 已激活');
      response.appendResponseLine(`- Vue 版本：${result.version}`);
      response.appendResponseLine('');
      response.appendResponseLine('现在可以在 Chrome DevTools 中使用 Vue.js devtools 插件：');
      response.appendResponseLine('  - Vue 2.x: 安装 "Vue.js devtools" (v5)');
      response.appendResponseLine('  - Vue 3.x: 安装 "Vue.js devtools"');
      response.appendResponseLine('');
      response.appendResponseLine('注意：两个版本的插件不能同时启用。');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
