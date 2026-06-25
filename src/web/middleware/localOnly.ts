/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * localOnly 中间件 —— 仅允许来自 127.0.0.1 / ::1 的请求。
 *
 * 安全策略：Browser 控制台默认绑定 127.0.0.1:8765，但即便如此，宿主机上其它
 * 进程理论上仍能通过本地接口访问。该中间件作为协议层兜底，强制返回 403 给所有
 * 非 loopback 来源。
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

export function isLoopback(req: IncomingMessage): boolean {
  // socket.remoteAddress 是 Node 提供的连接级真值；不信任任何 X-Forwarded-For 头
  const addr = req.socket.remoteAddress ?? '';
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1'
  );
}

/**
 * 若来源非 loopback，写 403 并返回 true（调用方应立即 return，不再处理后续路由）。
 * 否则返回 false。
 */
export function rejectIfNotLocal(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (isLoopback(req)) return false;

  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      success: false,
      error: {
        code: 'FORBIDDEN_NON_LOOPBACK',
        message: 'Browser 控制台仅接受 127.0.0.1 来源',
      },
    }),
  );
  return true;
}
