/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {ToolMeta} from '../../tools/tools-meta.js';
import type {JobStore} from '../../worker/JobStore.js';
import type {ToolAdapter} from '../../worker/ToolAdapter.js';
import {sendError, sendJson} from '../middleware/error.js';
import type {WsHub} from '../ws/WsHub.js';

export interface ApiV1Deps {
  toolAdapter: ToolAdapter;
  jobStore: JobStore;
  wsHub: WsHub;
  getToolMeta: (name: string) => ToolMeta | undefined;
  listToolsMeta: () => ToolMeta[];
  ensureToolsMeta: () => Promise<void>;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

const sessions = new Map<string, {sessionId: string; createdAt: string}>();
const startTime = Date.now();
let pkgVersion = '0.0.0';
try {
  pkgVersion =
    (await import('../../../package.json', {with: {type: 'json'}})).default
      .version ?? '0.0.0';
} catch {
  // ignore
}

function readJsonBody(
  req: IncomingMessage,
  limitBytes = 4 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      received += c.length;
      if (received > limitBytes) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(c);
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

export function createApiV1Routes(deps: ApiV1Deps): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();

  routes.set('GET /api/v1/health', async (_req, res) => {
    sendJson(res, {
      status: 'ok',
      uptimeMs: Date.now() - startTime,
      version: pkgVersion,
    });
  });

  routes.set('GET /api/v1/tools', async (_req, res) => {
    sendJson(res, {tools: deps.listToolsMeta()});
  });

  routes.set('GET /api/v1/tools/:name', async (_req, res, params) => {
    const meta = deps.getToolMeta(params!.name);
    if (!meta) {
      sendError(res, 'TOOL_NOT_FOUND', `tool not found: ${params!.name}`, 404);
      return;
    }
    sendJson(res, meta);
  });

  routes.set('POST /api/v1/sessions', async (_req, res) => {
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(id, {sessionId: id, createdAt: new Date().toISOString()});
    sendJson(
      res,
      {sessionId: id, createdAt: sessions.get(id)!.createdAt},
      undefined,
      201,
    );
  });

  routes.set('GET /api/v1/sessions', async (_req, res) => {
    sendJson(res, {sessions: [...sessions.values()]});
  });

  routes.set('DELETE /api/v1/sessions/:id', async (_req, res, params) => {
    const existed = sessions.delete(params!.id);
    if (!existed) {
      sendError(
        res,
        'SESSION_NOT_FOUND',
        `session not found: ${params!.id}`,
        404,
      );
      return;
    }
    sendJson(res, {deleted: true});
  });

  routes.set('POST /api/v1/sessions/:id/invoke', async (req, res, params) => {
    const body = (await readJsonBody(req)) as {
      tool?: string;
      params?: Record<string, unknown>;
    };
    const tool = body.tool;
    if (!tool || typeof tool !== 'string') {
      sendError(res, 'VALIDATION', 'body.tool (string) is required', 400);
      return;
    }
    const meta = deps.getToolMeta(tool);
    if (!meta) {
      sendError(res, 'TOOL_NOT_FOUND', `tool not found: ${tool}`, 404);
      return;
    }
    const sessionId = params!.id;
    if (!sessions.has(sessionId)) {
      sendError(
        res,
        'SESSION_NOT_FOUND',
        `session not found: ${sessionId}`,
        404,
      );
      return;
    }
    const job = deps.jobStore.create(sessionId, tool, body.params ?? {});
    void runJob(deps, job.jobId, meta, body.params ?? {}, sessionId);
    sendJson(
      res,
      {jobId: job.jobId, sessionId, status: 'pending'},
      undefined,
      202,
    );
  });

  routes.set('GET /api/v1/jobs/:id', async (_req, res, params) => {
    try {
      const job = deps.jobStore.get(params!.id);
      sendJson(res, job);
    } catch {
      sendError(res, 'JOB_NOT_FOUND', `job not found: ${params!.id}`, 404);
    }
  });

  return routes;
}

async function runJob(
  deps: ApiV1Deps,
  jobId: string,
  meta: ToolMeta,
  params: Record<string, unknown>,
  sessionId: string,
): Promise<void> {
  deps.jobStore.markRunning(jobId);
  try {
    const result = await deps.toolAdapter.executeTool(meta, params, sessionId);
    deps.jobStore.complete(jobId, result);
  } catch (err) {
    const e = err as {code?: string; message?: string};
    deps.jobStore.fail(jobId, {
      code: e.code ?? 'RUNTIME',
      message: e.message ?? String(err),
    });
  }
}
