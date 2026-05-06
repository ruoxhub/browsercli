/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {zod} from '../../third_party/index.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

/**
 * 获取 Vue Router 路由表：已加载的路由配置信息。
 */
export const getVueRoutes = defineTool({
  name: 'get_vue_routes',
  description: 'Get Vue Router route table from the current page (supports Vue 2/3)',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    includeChildren: zod
      .boolean()
      .optional()
      .describe('Include child routes (default: true)'),
    maxDepth: zod
      .number()
      .optional()
      .describe('Maximum depth for nested routes (default: 3)'),
  },
  handler: async (request, response, context) => {
    const withChildren = request.params.includeChildren ?? true;
    const depth = request.params.maxDepth ?? 3;
    const frame = context.getSelectedFrame();

    const getCode = `
(function() {
  function findVueInstance() {
    const rootElement = document.querySelector('[id="app"], [data-v-app]');
    if (rootElement && rootElement.__vue_app__) {
      return rootElement.__vue_app__;
    }

    for (const key in window) {
      if (key.startsWith('__vue')) {
        const app = window[key];
        if (app && app.$router) {
          return app;
        }
      }
    }

    return null;
  }

  function extractRoutes(router, d) {
    if (!router || d > ${depth}) return [];

    const routes = router.options?.routes || router.options || [];

    return routes.map(route => {
      const extracted = {
        path: route.path,
        name: route.name,
        component: route.component?.__name || route.component?.name || 'Anonymous',
      };

      if (${withChildren} && route.children && route.children.length > 0) {
        extracted.children = extractRoutes({ options: route.children }, d + 1);
      }

      return extracted;
    });
  }

  const app = findVueInstance();
  const router = app?.$router || app?._router;

  if (!router) {
    return {
      found: false,
      error: 'Vue Router not found. This page may not use Vue or Vue Router.'
    };
  }

  const routes = extractRoutes(router, 0);
  const currentRoute = router.currentRoute?.value || router.currentRoute;

  return {
    found: true,
    vueVersion: router.constructor?.name?.includes('VueRouter') ? '2.x' : '3.x',
    routes,
    currentRoute: {
      path: currentRoute?.path,
      name: currentRoute?.name,
    },
  };
})();
`;

    try {
      const result = (await frame.evaluate(getCode)) as {
        found: boolean;
        vueVersion?: string;
        routes?: any[];
        currentRoute?: {path: string; name: string};
        error?: string;
      };

      if (!result.found) {
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              message: result.error || '未检测到 Vue Router',
              tooltype: 'get_vue_routes',
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
            message: `Vue Router 已检测到，版本：${result.vueVersion}，路由数：${result.routes?.length || 0}，当前路由：${result.currentRoute?.path || 'N/A'}`,
            tooltype: 'get_vue_routes',
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
            tooltype: 'get_vue_routes',
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
