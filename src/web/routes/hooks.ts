/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {getToolMeta} from '../../tools/tools-meta.js';
import type {ToolAdapter} from '../../worker/ToolAdapter.js';
import {sendError, sendJson, sendUnexpected} from '../middleware/error.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024;

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createHookRoutes(
  toolAdapter: ToolAdapter,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/hooks',
      async (_req, res) => {
        try {
          const listHooksMeta = getToolMeta('list_hooks');
          if (!listHooksMeta) {
            sendError(res, 'NOT_FOUND', 'list_hooks tool not found', 404);
            return;
          }
          const list = await toolAdapter.executeTool(listHooksMeta, {});
          sendJson(res, list);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'POST /api/hooks',
      async (req, res) => {
        let args: Record<string, unknown>;
        try {
          const body = await readJsonBody(req);
          args =
            typeof body === 'object' && body !== null && !Array.isArray(body)
              ? (body as Record<string, unknown>)
              : {};
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          if (code === 'PAYLOAD_TOO_LARGE') {
            sendError(res, code, '请求体超过 1MB 上限', 413);
          } else {
            sendError(res, code, '请求体不是合法 JSON', 400);
          }
          return;
        }

        try {
          const hookFunctionMeta = getToolMeta('hook_function');
          if (!hookFunctionMeta) {
            sendError(res, 'NOT_FOUND', 'hook_function tool not found', 404);
            return;
          }
          const result = await toolAdapter.executeTool(hookFunctionMeta, args);
          sendJson(res, result);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'DELETE /api/hooks/:id',
      async (_req, res, params) => {
        const id = params?.id;
        if (!id) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        try {
          const unhookFunctionMeta = getToolMeta('unhook_function');
          if (!unhookFunctionMeta) {
            sendError(res, 'NOT_FOUND', 'unhook_function tool not found', 404);
            return;
          }
          const result = await toolAdapter.executeTool(unhookFunctionMeta, {
            hookId: id,
          });
          sendJson(res, result);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
  ]);
}
