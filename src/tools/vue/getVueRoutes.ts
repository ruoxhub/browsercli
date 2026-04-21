/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * 获取 Vue Router 路由表：已加载的路由配置信息。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param includeChildren - 是否包含子路由，默认 true
 * @param maxDepth - 最大递归深度，默认 3
 * @returns 结构化结果对象
 */
export async function getVueRoutes(
  frame: Frame,
  includeChildren?: boolean,
  maxDepth?: number,
): Promise<HookResult> {
  const withChildren = includeChildren ?? true;
  const depth = maxDepth ?? 3;

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
      return {
        success: false,
        message: result.error || '未检测到 Vue Router',
        tooltype: 'get_vue_routes',
      };
    }

    return {
      success: true,
      message: `Vue Router 已检测到，版本：${result.vueVersion}，路由数：${result.routes?.length || 0}，当前路由：${result.currentRoute?.path || 'N/A'}`,
      tooltype: 'get_vue_routes',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_vue_routes',
    };
  }
}
