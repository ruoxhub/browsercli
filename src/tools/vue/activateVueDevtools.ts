/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

/**
 * 激活 Vue Devtools：强制启用 Vue.js 和 Pinia 开发者工具（支持 Vue 2/3 + Pinia）。
 */
export const activateVueDevtools = defineTool({
  name: 'activate_vue_devtools',
  description: 'Force-enable Vue.js and Pinia DevTools (supports Vue 2/3 + Pinia)',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {},
  handler: async (_request, response, context) => {
    const frame = context.getSelectedFrame();

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
      return;
    }
    const pinia = vueRootInstance.config.globalProperties.$pinia;
    if (!pinia) return;

    if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
      pinia.use(function(devtoolsPlugin) {
        const store = devtoolsPlugin.store;
        const app = devtoolsPlugin.app;
        const api = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;

        if (!api.componentStateTypes) {
          api.componentStateTypes = [];
        }
        const typeLabel = '\\ud83c\\udf4d ' + store.$id;
        if (!api.componentStateTypes.includes(typeLabel)) {
          api.componentStateTypes.push(typeLabel);
        }
      });

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

    try {
      enablePiniaDevtools(app, 3);
    } catch (e) {
      console.warn('[activate_vue_devtools] Pinia devtools failed:', e);
    }

    return {success: true, version: version, piniaEnabled: true};
  }

  function crack() {
    if (window.__VUE__) {
      return crackVue3();
    }
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].__vue__) {
        return crackVue2();
      }
    }
    return {success: false, reason: 'Vue instance not found'};
  }

  try {
    if (!window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
      return {success: false, error: 'Vue Devtools hook not found. Please install Vue Devtools extension.'};
    }

    const result = crack();

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
      const result = (await frame.evaluate(hookCode)) as {
        success: boolean;
        version?: string;
        piniaEnabled?: boolean;
        error?: string;
        message?: string;
      };

      if (!result.success) {
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              message: result.error || result.message || '激活失败',
              tooltype: 'activate_vue_devtools',
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `Vue Devtools 已激活，版本：${result.version}${result.piniaEnabled ? ' (Pinia 已启用)' : ''}`,
            tooltype: 'activate_vue_devtools',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `错误：${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'activate_vue_devtools',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
