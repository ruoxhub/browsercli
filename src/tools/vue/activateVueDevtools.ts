/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const activateVueDevtools = defineTool({
  name: 'activate_vue_devtools',
  description:
    '激活 Vue Devtools：强制启用 Vue.js 和 Pinia 开发者工具（支持 Vue 2/3 + Pinia，带重试机制）',
  annotations: {
    title: 'Activate Vue Devtools',
    category: ToolCategory.HOOK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (
    _request: {params: Record<string, never>},
    response: Response,
    context: Context,
    _runtime,
  ) => {
    const hookCode = `
(function() {
  'use strict';

  const COLOR = {
    log: '#1475b2',
    info: '#606060',
    error: '#42b883',
  };
  const message = ({ type, params }) => {
    const LOG_MARK = [
      '%c vue-force-dev',
      'padding: 1px; border-radius: 0 3px 3px 0; color: #fff; background:' + COLOR[type]
    ];
    console[type](...LOG_MARK, ...params);
  };

  function getVueRootInstance(version) {
    const signProperty = version === 2 ? '__vue__' : '__vue_app__';
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i][signProperty]) {
        return all[i][signProperty];
      }
    }
  }

  function isPinia(o) {
    return '_a' in o && 'install' in o;
  }

  function enablePiniaDevtools(vueRootInstance, vueVersion) {
    if (vueVersion === 2) {
      return; // Pinia Vue2 support not available
    }
    const pinia = vueRootInstance.config.globalProperties.$pinia;
    if (!pinia) return;

    // Register Pinia devtools
    if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
      pinia.use(function(devtoolsPlugin) {
        const store = devtoolsPlugin.store;
        const app = devtoolsPlugin.app;
        const api = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;

        // Add to component state types
        if (!api.componentStateTypes) {
          api.componentStateTypes = [];
        }
        const typeLabel = '\\ud83c\\udf4d ' + store.$id;
        if (!api.componentStateTypes.includes(typeLabel)) {
          api.componentStateTypes.push(typeLabel);
        }
      });

      // Emit app init for Pinia
      window.__VUE_DEVTOOLS_GLOBAL_HOOK__.emit('app:init',
        vueRootInstance,
        vueRootInstance.version || '3.x',
        {
          Fragment: Symbol.for('v-fgt'),
          Text: Symbol.for('v-txt'),
          Comment: Symbol.for('v-cmt'),
          Static: Symbol.for('v-stc'),
        }
      );
    }
  }

  function crackVue2(Vue) {
    if (!Vue) {
      const app = getVueRootInstance(2);
      if (!app) return {success: false, reason: 'Vue2 instance not found'};
      Vue = Object.getPrototypeOf(app).constructor;
      while (Vue.super) {
        Vue = Vue.super;
      }
    }
    const devtools = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    Vue.config.devtools = true;
    devtools.emit('init', Vue);
    return {success: true, version: Vue.version || '2.x'};
  }

  function crackVue3() {
    const app = getVueRootInstance(3);
    if (!app) return {success: false, reason: 'Vue3 instance not found'};
    const devtools = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    devtools.enabled = true;
    const version = app.version || '3.x';
    devtools.emit('app:init', app, version, {
      Fragment: Symbol.for('v-fgt'),
      Text: Symbol.for('v-txt'),
      Comment: Symbol.for('v-cmt'),
      Static: Symbol.for('v-stc'),
    });

    // Enable Pinia devtools if available
    try {
      enablePiniaDevtools(app, 3);
    } catch (e) {
      console.warn('[activate_vue_devtools] Pinia devtools failed:', e);
    }

    return {success: true, version: version, piniaEnabled: true};
  }

  function crack() {
    // Vue 3 check
    if (window.__VUE__) {
      return crackVue3();
    }
    // Vue 2 check
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].__vue__) {
        return crackVue2();
      }
    }
    return {success: false, reason: 'Vue instance not found'};
  }

  // Retry with exponential backoff
  function executeWithRetry(maxTries, baseDelay) {
    let tries = 0;
    let delay = baseDelay;

    function attempt() {
      tries++;
      const result = crack();
      if (result.success) return result;
      if (tries < maxTries) {
        // Sync sleep not available in page context, use timing approach
        return null; // signal to retry
      }
      return result; // final failure
    }

    // First attempt
    const firstResult = attempt();
    if (firstResult) return firstResult;

    // Retry loop
    while (tries < maxTries) {
      // Simple busy-wait approximation
      const start = Date.now();
      while (Date.now() - start < delay) { /* wait */ }
      delay *= 2;

      const retryResult = attempt();
      if (retryResult) return retryResult;
    }

    return {success: false, reason: 'Vue instance not found after ' + maxTries + ' retries'};
  }

  // Main execution
  try {
    if (!window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
      return {success: false, error: 'Vue Devtools hook not found. Please install Vue Devtools extension.'};
    }

    const result = executeWithRetry(5, 200);

    if (result.success) {
      return {
        success: true,
        version: result.version,
        piniaEnabled: result.piniaEnabled || false,
        message: 'Vue ' + result.version + ' Devtools activated' +
          (result.piniaEnabled ? ' (with Pinia support)' : '')
      };
    } else {
      return {
        success: false,
        error: result.reason || 'Unknown error',
        message: 'Failed to activate Vue Devtools'
      };
    }
  } catch (e) {
    return {success: false, error: 'Unexpected error: ' + e.message};
  }
})();
`;

    try {
      const frame = context.getSelectedFrame();
      const result = (await frame.evaluate(hookCode)) as {
        success: boolean;
        version?: string;
        piniaEnabled?: boolean;
        error?: string;
        message?: string;
      };

      if (!result.success) {
        response.appendResponseLine('❌ 激活失败');
        response.appendResponseLine(
          result.error || result.message || '未知错误',
        );
        response.appendResponseLine('');
        response.appendResponseLine(
          '提示：请确保页面已加载 Vue 框架，且已安装 Vue Devtools 扩展。',
        );
        return;
      }

      response.appendResponseLine('✅ Vue Devtools 已激活');
      response.appendResponseLine(`- Vue 版本：${result.version}`);
      if (result.piniaEnabled) {
        response.appendResponseLine('- Pinia Devtools：已启用');
      }
      response.appendResponseLine('');
      response.appendResponseLine(
        '现在可以在 Chrome DevTools 中使用 Vue.js devtools 插件：',
      );
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
