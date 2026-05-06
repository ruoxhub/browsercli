/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

/**
 * 清除 Vue Router 全局守卫：beforeEach、beforeResolve。
 */
export const clearVueGuards = defineTool({
  name: 'clear_vue_guards',
  description: 'Clear Vue Router global guards (beforeEach, beforeResolve, afterEach)',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    guards: zod
      .array(zod.enum(['beforeEach', 'beforeResolve', 'afterEach', 'all']))
      .optional()
      .describe('Guards to clear (default: ["all"])'),
  },
  handler: async (request, response, context) => {
    const guardList = request.params.guards || ['all'];
    const frame = context.getSelectedFrame();

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

  if (guards.includes('beforeEach') || guards.includes('all')) {
    if (router.beforeEach) {
      router.beforeEach((to, from, next) => next());
      clearedGuards.push('beforeEach');
    }
  }

  if (guards.includes('beforeResolve') || guards.includes('all')) {
    if (router.beforeResolve) {
      router.beforeResolve((to, from, next) => next());
      clearedGuards.push('beforeResolve');
    }
  }

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
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              message: result.error || '未知错误',
              tooltype: 'clear_vue_guards',
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
            message: `Vue Router 守卫已清除：${result.clearedGuards?.join(', ') || 'none'}`,
            tooltype: 'clear_vue_guards',
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
            tooltype: 'clear_vue_guards',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
