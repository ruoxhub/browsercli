/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools REST routes
 *
 *  GET  /api/tools             — 列出所有工具 + JSON Schema
 *  POST /api/tools/:name       — 调用工具（body ≤ 1MB），结果落 InvocationStore
 *
 * 调用路径：ConsoleServer 嵌在 Worker 进程内，但 Phase 1 仍走 SekiroInvoker.invoke
 * (group, name, args) 三参——保持与 LLM 调用同一条路径，便于 traceId / Recorder
 * / EventBus 全链路一致。后续若需要"控制台直连本地 Pipeline"再加分支。
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {SekiroInvoker} from '../../cli/sekiro-invoker.js';
import {getAllToolsMeta, getToolMeta} from '../../cli/tools-meta.js';
import type {InvocationStore} from '../adapters/InvocationStore.js';
import {toolMetaToJsonSchema} from '../adapters/ZodToJsonSchema.js';
import {sendError, sendJson, sendUnexpected} from '../middleware/error.js';
import type {InvocationRecord} from '../types.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024;

export interface ToolsRoutesConfig {
  invoker: SekiroInvoker;
  group: string;
  invocations: InvocationStore;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

/**
 * 读取 JSON body，硬上限 1MB。超过立刻返回 413 并断流。
 */
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

function makeTraceId(): string {
  return `tr_rest_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createToolsRoutes(
  cfg: ToolsRoutesConfig,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/tools',
      (_req, res) => {
        try {
          const tools = getAllToolsMeta().map(meta => ({
            name: meta.name,
            description: meta.description,
            domain: meta.domain,
            profile: meta.profile,
            inputSchema: toolMetaToJsonSchema(meta),
          }));
          sendJson(res, {tools, total: tools.length});
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'POST /api/tools/:name',
      async (req, res, params) => {
        const toolName = params?.name;
        if (!toolName) {
          sendError(res, 'BAD_REQUEST', '缺少 :name 路径参数', 400);
          return;
        }
        const meta = getToolMeta(toolName);
        if (!meta) {
          sendError(res, 'NOT_FOUND', `未知工具: ${toolName}`, 404);
          return;
        }

        let args: Record<string, unknown>;
        try {
          const body = await readJsonBody(req);
          args =
            typeof body === 'object' && body !== null && !Array.isArray(body)
              ? (body as Record<string, unknown>)
              : {};
        } catch (err) {
          const code =
            err instanceof Error ? err.message : 'INVALID_JSON';
          if (code === 'PAYLOAD_TOO_LARGE') {
            sendError(res, code, '请求体超过 1MB 上限', 413);
          } else {
            sendError(res, code, '请求体不是合法 JSON', 400);
          }
          return;
        }

        const traceId = makeTraceId();
        const startedAt = Date.now();

        try {
          const result = await cfg.invoker.invoke(cfg.group, toolName, args);
          const durationMs = Date.now() - startedAt;
          const record: InvocationRecord = cfg.invocations.add({
            traceId,
            toolName,
            success: true,
            startedAt: new Date(startedAt).toISOString(),
            durationMs,
            args,
            result,
          });
          sendJson(
            res,
            {
              invocationId: record.id,
              traceId,
              durationMs,
              result,
            },
            {traceId, ts: Date.now()},
          );
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          const message = err instanceof Error ? err.message : String(err);
          cfg.invocations.add({
            traceId,
            toolName,
            success: false,
            startedAt: new Date(startedAt).toISOString(),
            durationMs,
            args,
            error: {code: 'INVOKE_FAILED', message},
          });
          sendError(res, 'INVOKE_FAILED', message, 502, {traceId, durationMs});
        }
      },
    ],
  ]);
}
