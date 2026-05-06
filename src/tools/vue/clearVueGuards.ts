/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {HookResult, VueGuard} from './types.js';

/**
 * 清除 Vue Router 全局守卫：beforeEach、beforeResolve。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param params - 参数对象 { guards? }
 * @returns 结构化结果对象
 */
export async function clearVueGuards(
  frame: Frame,
  params?: { guards?: VueGuard[] },
): Promise<HookResult> {
  const guardList = params?.guards || ['all'];

  const hookCode = `
(function() {
  'use strict';

  const guards = ${JSON.stringify(guardList)};

  function findRouter() {
    const rootElement = document.querySelector('[id="app"], [data-v-app]');
    if (rootElement && rootElement.__vue_app__) {
      return rootElement.__vue_app__?.$router;
    }

    for (const key in window) {
      if (key.startsWith('__vue')) {
        const app = window[key];
        if (app && app.$router) {
          return app.$router;
        }
      }
    }

    return null;
  }

  const router = findRouter();

  if (!router) {
    return { success: false, error: 'Vue Router not found' };
  }

  const clearedGuards = [];

  // Clear beforeEach
  if (guards.includes('beforeEach') || guards.includes('all')) {
    if (router.beforeEach) {
      router.beforeEach((to, from, next) => next());
      clearedGuards.push('beforeEach');
    }
  }

  // Clear beforeResolve
  if (guards.includes('beforeResolve') || guards.includes('all')) {
    if (router.beforeResolve) {
      router.beforeResolve((to, from, next) => next());
      clearedGuards.push('beforeResolve');
    }
  }

  // Clear afterEach
  if (guards.includes('afterEach') || guards.includes('all')) {
    if (router.afterEach) {
      router.afterEach(() => {});
      clearedGuards.push('afterEach');
    }
  }

  console.log('[clear_vue_guards] ✅ Cleared guards:', clearedGuards);

  return { success: true, clearedGuards };
})();
`;

  try {
    const result = (await frame.evaluate(hookCode)) as {
      success: boolean;
      clearedGuards?: string[];
      error?: string;
    };

    if (!result.success) {
      return {
        success: false,
        message: result.error || '未知错误',
        tooltype: 'clear_vue_guards',
      };
    }

    return {
      success: true,
      message: `Vue Router 守卫已清除：${result.clearedGuards?.join(', ') || 'none'}`,
      tooltype: 'clear_vue_guards',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'clear_vue_guards',
    };
  }
}
