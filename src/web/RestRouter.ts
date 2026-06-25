/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 简易 REST 路由分派器（不依赖 express）。
 *
 * 把多个 Map<"METHOD /path", handler> 聚成一个 dispatch 函数：
 *   - 直接精确匹配优先
 *   - 否则按 "METHOD /api/foo/:param" 模板做参数提取（一段 :name）
 *   - 命中调用 handler(req, res, params)，返回 true
 *   - 未命中返回 false（让上层做 404 或继续静态资源分派）
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {sendError} from './middleware/error.js';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

interface CompiledRoute {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

function compileRoute(key: string, handler: RouteHandler): CompiledRoute {
  const [method, path] = key.split(' ', 2) as [string, string];
  const paramNames: string[] = [];
  const regexSource = path
    .replace(/[.*+?^${}()|[\]\\]/g, m => `\\${m}`)
    .replace(/:(\w+)/g, (_full, name: string) => {
      paramNames.push(name);
      return '([^/]+)';
    });
  return {
    method: method.toUpperCase(),
    pattern: new RegExp(`^${regexSource}/?$`),
    paramNames,
    handler,
  };
}

export class RestRouter {
  private readonly routes: CompiledRoute[] = [];

  mount(table: Map<string, RouteHandler>): void {
    for (const [key, handler] of table) {
      this.routes.push(compileRoute(key, handler));
    }
  }

  /**
   * 尝试派发到注册的路由。命中 → 调用 handler 并返回 true；未命中 → 返回 false。
   */
  async dispatch(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const method = (req.method ?? 'GET').toUpperCase();
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? '');
      });
      try {
        await r.handler(req, res, params);
      } catch (err) {
        if (!res.headersSent) {
          const message = err instanceof Error ? err.message : String(err);
          sendError(res, 'INTERNAL', message, 500);
        }
      }
      return true;
    }
    return false;
  }
}
