/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 错误中间件 —— 统一 JSON 响应构造器。
 *
 * 路由层只关心业务逻辑；HTTP 状态码、Content-Type、JSON 序列化、错误码归一化
 * 全部由此处提供。所有 4xx/5xx 走 sendError，所有 2xx 走 sendJson，避免每个
 * 路由各自手工拼 res.end(JSON.stringify(...))。
 */

import type {ServerResponse} from 'node:http';

import type {ApiResponse} from '../types.js';

const JSON_HEADERS = {'Content-Type': 'application/json; charset=utf-8'};

export function sendJson<T>(
  res: ServerResponse,
  data: T,
  meta?: ApiResponse<T>['meta'],
  statusCode = 200,
): void {
  res.statusCode = statusCode;
  for (const [k, v] of Object.entries(JSON_HEADERS)) res.setHeader(k, v);
  const body: ApiResponse<T> = {
    success: true,
    data,
    ...(meta && {meta}),
  };
  res.end(JSON.stringify(body));
}

export function sendError(
  res: ServerResponse,
  code: string,
  message: string,
  statusCode = 500,
  details?: unknown,
): void {
  res.statusCode = statusCode;
  for (const [k, v] of Object.entries(JSON_HEADERS)) res.setHeader(k, v);
  const body: ApiResponse<never> = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && {details}),
    },
  };
  res.end(JSON.stringify(body));
}

/**
 * 把 unknown 异常归一化为 ApiResponse error。生产路由用 try/catch 包裹后调用此函数。
 */
export function sendUnexpected(res: ServerResponse, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  sendError(res, 'INTERNAL', message, 500);
}
