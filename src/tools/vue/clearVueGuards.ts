/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const clearVueGuards = defineTool({
  name: 'clear_vue_guards',
  description: '清除 Vue Router 全局守卫：beforeEach、beforeResolve',
  annotations: {
    title: 'Clear Vue Guards',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    guards: zod
      .array(zod.enum(['beforeEach', 'beforeResolve', 'afterEach', 'all']))
      .optional()
      .describe('要清除的守卫，默认全部'),
  },
  handler: async (
    request: {
      params: {
        guards?: Array<'beforeEach' | 'beforeResolve' | 'afterEach' | 'all'>;
      };
    },
    response: Response,
    context: Context,
    runtime,
  ) => {
    const guards = request.params.guards || ['all'];

    const hookCode = `
(function() {
  'use strict';

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
      const frame = context.getSelectedFrame();
      const result = (await frame.evaluate(hookCode)) as {
        success: boolean;
        clearedGuards?: string[];
        error?: string;
      };

      if (!result.success) {
        response.appendResponseLine('❌ 清除失败');
        response.appendResponseLine(result.error || '未知错误');
        return;
      }

      response.appendResponseLine('✅ Vue Router 守卫已清除');
      response.appendResponseLine(
        `- 已清除的守卫：${result.clearedGuards?.join(', ') || 'none'}`,
      );
      response.appendResponseLine('');
      response.appendResponseLine('现在路由跳转将不会被拦截。');
      response.appendResponseLine('如需恢复，请刷新页面。');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
