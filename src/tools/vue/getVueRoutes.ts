/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const getVueRoutes = defineTool({
  name: 'get_vue_routes',
  description: '获取 Vue Router 路由表：已加载的路由配置信息',
  annotations: {
    title: 'Get Vue Routes',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    includeChildren: zod
      .boolean()
      .optional()
      .default(true)
      .describe('是否包含子路由'),
    maxDepth: zod.number().int().optional().default(3).describe('最大递归深度'),
  },
  handler: async (
    request: {params: {includeChildren?: boolean; maxDepth?: number}},
    response: Response,
    context: Context,
    runtime,
  ) => {
    const includeChildren = request.params.includeChildren ?? true;
    const maxDepth = request.params.maxDepth ?? 3;

    const getCode = `
(function() {
  function findVueInstance() {
    // Vue 3
    const rootElement = document.querySelector('[id="app"], [data-v-app]');
    if (rootElement && rootElement.__vue_app__) {
      return rootElement.__vue_app__;
    }

    // Vue 2
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

  function extractRoutes(router, depth = 0) {
    if (!router || depth > ${maxDepth}) return [];

    const routes = router.options?.routes || router.options || [];

    return routes.map(route => {
      const extracted = {
        path: route.path,
        name: route.name,
        component: route.component?.__name || route.component?.name || 'Anonymous',
      };

      if (${includeChildren} && route.children && route.children.length > 0) {
        extracted.children = extractRoutes({ options: route.children }, depth + 1);
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

  const routes = extractRoutes(router);
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
      const frame = context.getSelectedFrame();
      const result = (await frame.evaluate(getCode)) as {
        found: boolean;
        vueVersion?: string;
        routes?: any[];
        currentRoute?: {path: string; name: string};
        error?: string;
      };

      if (!result.found) {
        response.appendResponseLine('❌ 未检测到 Vue Router');
        response.appendResponseLine(
          result.error || '此页面可能未使用 Vue 或 Vue Router',
        );
        return;
      }

      response.appendResponseLine('✅ Vue Router 已检测到');
      response.appendResponseLine(`- Vue 版本：${result.vueVersion}`);
      response.appendResponseLine(
        `- 当前路由：${result.currentRoute?.path || 'N/A'} (${result.currentRoute?.name || 'N/A'})`,
      );
      response.appendResponseLine('');
      response.appendResponseLine(`路由表 (${result.routes?.length || 0}):`);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result.routes, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
