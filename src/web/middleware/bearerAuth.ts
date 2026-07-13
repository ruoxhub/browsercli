/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

export interface BearerAuthConfig {
  apiToken?: string;
  bindHost: string;
}

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * 仅作用于 /api/v1 的中间件。
 * 规则：
 *  - 未设 apiToken 且绑定 loopback => 放行（开发便利）
 *  - 绑定非 loopback 或显式设了 apiToken => 要求 Authorization: Bearer <token>
 * 返回 true 表示已写 401 并拒绝（调用方应 return）。
 */
export function bearerAuth(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: BearerAuthConfig,
): boolean {
  const requiresAuth = !!cfg.apiToken || !isLoopback(cfg.bindHost);
  if (!requiresAuth) return false;

  const header = req.headers['authorization'];
  if (typeof header === 'string' && cfg.apiToken && header === `Bearer ${cfg.apiToken}`) {
    return false;
  }

  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({error: {code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token'}}));
  return true;
}
