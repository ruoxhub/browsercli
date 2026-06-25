/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Invocations REST routes
 *
 *  GET /api/invocations         — 最近 N 条调用记录（默认 100）
 *  GET /api/invocations/:id     — 单条详情
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {InvocationStore} from '../adapters/InvocationStore.js';
import {sendError, sendJson} from '../middleware/error.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export interface InvocationsRoutesConfig {
  store: InvocationStore;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

function parseLimit(req: IncomingMessage): number {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const raw = url.searchParams.get('limit');
    if (!raw) return DEFAULT_LIMIT;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
  } catch {
    return DEFAULT_LIMIT;
  }
}

export function createInvocationsRoutes(
  cfg: InvocationsRoutesConfig,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/invocations',
      (req, res) => {
        const limit = parseLimit(req);
        const records = cfg.store.getRecent(limit);
        sendJson(res, {records, total: records.length, limit});
      },
    ],
    [
      'GET /api/invocations/:id',
      (_req, res, params) => {
        const id = params?.id;
        if (!id) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        const record = cfg.store.getById(id);
        if (!record) {
          sendError(res, 'NOT_FOUND', `未找到调用记录 ${id}`, 404);
          return;
        }
        sendJson(res, record);
      },
    ],
  ]);
}
