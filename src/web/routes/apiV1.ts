/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {getRuntimeConfigStore} from '../../config/RuntimeConfigStore.js';
import {type BrowserConfig, BrowserConfigSchema} from '../../config/schema.js';
import {getBrowserManagerConfig} from '../../config/servicesConfig.js';
import type {BrowserManagerConfig} from '../../modules/browser/index.js';
import type {ToolMeta} from '../../tools/tools-meta.js';
import {
  connectBrowser,
  disconnectBrowser,
  getBrowserConnectionStatus,
} from '../../worker/BrowserConnectionManager.js';
import type {JobStore} from '../../worker/JobStore.js';
import type {ToolAdapter} from '../../worker/ToolAdapter.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {
  raceWithAbort,
  WorkerBusyError,
  workerActivityCoordinator,
} from '../../worker/WorkerActivityCoordinator.js';
import {sendError, sendJson} from '../middleware/error.js';
import type {WsHub} from '../ws/WsHub.js';

export interface ApiV1Deps {
  contextProvider: ToolContextProvider;
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

interface SessionRecord {
  sessionId: string;
  createdAt: string;
}

export interface ApiV1Options {
  jobTimeoutMs?: number;
  maxSessions?: number;
}

interface ActiveJob {
  jobId: string;
  controller: AbortController;
  execution: Promise<void>;
}

type JobAbortCode = 'JOB_TIMEOUT' | 'JOB_CANCELLED';

class JobAbortError extends Error {
  constructor(
    readonly code: JobAbortCode,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_JOB_TIMEOUT_MS = 300_000;

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

function sendJsonBodyError(res: ServerResponse, error: unknown): void {
  const code = error instanceof Error ? error.message : 'INVALID_JSON';
  sendError(
    res,
    code,
    code === 'PAYLOAD_TOO_LARGE'
      ? 'request body exceeds the size limit'
      : 'request body is not valid JSON',
    code === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
  );
}

const BrowserConnectSchema = BrowserConfigSchema.pick({
  acceptInsecureCerts: true,
  browserURL: true,
  channel: true,
  cloak: true,
  executablePath: true,
  fullStealthArgs: true,
  headless: true,
  isolated: true,
  jsStealth: true,
  minimalStealth: true,
  userDataDir: true,
  viewport: true,
  wsEndpoint: true,
  wsHeaders: true,
}).strict();

class BrowserConfigRequestError extends Error {
  constructor(
    readonly code: 'VALIDATION' | 'BROWSER_CONFIG_CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireProtocol(
  key: string,
  value: string | undefined,
  protocols: string[],
): void {
  if (value === undefined) return;
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new BrowserConfigRequestError('VALIDATION', `${key} is not a URL`);
  }
  if (!protocols.includes(protocol)) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      `${key} must use ${protocols.join(' or ')}`,
    );
  }
}

function parseBrowserConnectBody(body: unknown): BrowserConfig {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'request body must be an object',
    );
  }
  const remote = hasOwn(body, 'browserURL') || hasOwn(body, 'wsEndpoint');
  const local = hasOwn(body, 'channel') || hasOwn(body, 'executablePath');
  if (
    (hasOwn(body, 'browserURL') && hasOwn(body, 'wsEndpoint')) ||
    (hasOwn(body, 'channel') && hasOwn(body, 'executablePath')) ||
    (remote && local)
  ) {
    throw new BrowserConfigRequestError(
      'BROWSER_CONFIG_CONFLICT',
      'browserURL, wsEndpoint, channel, and executablePath select mutually exclusive targets',
    );
  }

  const parsed = BrowserConnectSchema.safeParse(body);
  if (!parsed.success) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      parsed.error.issues
        .map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    );
  }
  requireProtocol('browserURL', parsed.data.browserURL, ['http:', 'https:']);
  requireProtocol('wsEndpoint', parsed.data.wsEndpoint, ['ws:', 'wss:']);
  if (parsed.data.executablePath === '') {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'executablePath must not be empty',
    );
  }

  const patch: BrowserConfig = {...parsed.data};
  if (hasOwn(parsed.data, 'browserURL')) {
    patch.wsEndpoint = undefined;
    patch.channel = undefined;
    patch.executablePath = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (hasOwn(parsed.data, 'wsEndpoint')) {
    patch.browserURL = undefined;
    patch.channel = undefined;
    patch.executablePath = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (hasOwn(parsed.data, 'channel')) {
    patch.browserURL = undefined;
    patch.wsEndpoint = undefined;
    patch.executablePath = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (hasOwn(parsed.data, 'executablePath')) {
    patch.browserURL = undefined;
    patch.wsEndpoint = undefined;
    patch.channel = undefined;
    patch.remoteDebuggingUrl = undefined;
  }
  return patch;
}

function parseBrowserDisconnectBody(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.some(key => key !== 'force')) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'request body only supports force',
    );
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'force must be a boolean',
    );
  }
  return body.force === true;
}

function effectiveBrowserConfig(): BrowserManagerConfig {
  const config = {
    ...getBrowserManagerConfig(),
    ...(getRuntimeConfigStore().get().browser ?? {}),
  };
  return {
    ...config,
    channel: config.channel as BrowserManagerConfig['channel'],
  };
}

export function createApiV1Routes(
  deps: ApiV1Deps,
  options: ApiV1Options = {},
): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();
  const sessions = new Map<string, SessionRecord>();
  const jobTimeoutMs = Math.max(
    1,
    options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
  );
  const maxSessions = Math.max(1, options.maxSessions ?? 100);
  let activeJob: ActiveJob | undefined;

  function rejectIfBusy(
    res: ServerResponse,
    operation: 'tool' | 'browser',
  ): boolean {
    const activity = workerActivityCoordinator.getState();
    const activeJobId = activeJob?.jobId;
    const busyWithBrowser = activity.browserOperation !== undefined;
    const busyWithTool = activeJobId !== undefined || activity.activeTools > 0;
    if (
      !busyWithBrowser &&
      !(operation === 'browser' && busyWithTool) &&
      !(operation === 'tool' && activeJobId)
    ) {
      return false;
    }
    const message = activeJobId
      ? `worker is busy with job ${activeJobId}`
      : busyWithBrowser
        ? `worker is busy with browser ${activity.browserOperation}`
        : 'worker is busy running tools';
    sendError(
      res,
      'WORKER_BUSY',
      message,
      409,
      activeJobId
        ? {jobId: activeJobId}
        : busyWithBrowser
          ? {operation: activity.browserOperation}
          : {activeTools: activity.activeTools},
    );
    return true;
  }

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

  routes.set('GET /api/v1/browser/status', async (_req, res) => {
    sendJson(
      res,
      getBrowserConnectionStatus(
        deps.contextProvider,
        effectiveBrowserConfig(),
      ),
    );
  });

  routes.set('POST /api/v1/browser/connect', async (req, res) => {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJsonBodyError(res, error);
      return;
    }

    let patch: BrowserConfig;
    try {
      patch = parseBrowserConnectBody(body);
    } catch (error) {
      if (error instanceof BrowserConfigRequestError) {
        sendError(res, error.code, error.message, 400);
        return;
      }
      throw error;
    }

    if (rejectIfBusy(res, 'browser')) return;
    try {
      getRuntimeConfigStore().update({browser: patch});
      const config = effectiveBrowserConfig();
      await connectBrowser(deps.contextProvider, config);
      const status = getBrowserConnectionStatus(deps.contextProvider, config);
      deps.wsHub.broadcast('worker.status', {browser: status});
      sendJson(res, status);
    } catch (error) {
      if (error instanceof WorkerBusyError) {
        sendError(res, error.code, error.message, 409, error.state);
        return;
      }
      sendError(
        res,
        'BROWSER_CONNECT_FAILED',
        'failed to connect browser',
        502,
      );
    }
  });

  routes.set('POST /api/v1/browser/disconnect', async (req, res) => {
    let force: boolean;
    try {
      force = parseBrowserDisconnectBody(await readJsonBody(req));
    } catch (error) {
      if (error instanceof BrowserConfigRequestError) {
        sendError(res, error.code, error.message, 400);
      } else {
        sendJsonBodyError(res, error);
      }
      return;
    }

    if (!force && rejectIfBusy(res, 'browser')) return;
    try {
      if (activeJob) {
        const current = activeJob;
        current.controller.abort(
          new JobAbortError(
            'JOB_CANCELLED',
            'job cancelled by browser disconnect',
          ),
        );
        const settled = await Promise.race([
          current.execution.then(() => true).catch(() => true),
          new Promise<boolean>(resolve =>
            setTimeout(() => resolve(false), 1000),
          ),
        ]);
        if (!settled || force) {
          activeJob = undefined;
        }
      }
      await disconnectBrowser(deps.contextProvider, {force});
      const status = getBrowserConnectionStatus(
        deps.contextProvider,
        effectiveBrowserConfig(),
      );
      deps.wsHub.broadcast('worker.status', {browser: status});
      sendJson(res, status);
    } catch (error) {
      if (error instanceof WorkerBusyError) {
        sendError(res, error.code, error.message, 409, error.state);
        return;
      }
      sendError(
        res,
        'BROWSER_DISCONNECT_FAILED',
        'failed to disconnect browser',
        502,
      );
    }
  });

  routes.set('POST /api/v1/sessions', async (_req, res) => {
    if (sessions.size >= maxSessions) {
      const oldestSessionId = sessions.keys().next().value;
      if (oldestSessionId) sessions.delete(oldestSessionId);
    }
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
    const session = sessions.get(sessionId);
    if (!session) {
      sendError(
        res,
        'SESSION_NOT_FOUND',
        `session not found: ${sessionId}`,
        404,
      );
      return;
    }

    if (rejectIfBusy(res, 'tool')) return;

    let job;
    try {
      job = deps.jobStore.create(sessionId, tool, body.params ?? {});
    } catch (error) {
      if (error instanceof Error && error.message === 'JOB_STORE_FULL') {
        sendError(
          res,
          'JOB_STORE_FULL',
          'too many active jobs; retry after an existing job finishes',
          503,
        );
        return;
      }
      throw error;
    }

    const controller = new AbortController();
    const execution = runJob(
      deps,
      job.jobId,
      meta,
      body.params ?? {},
      sessionId,
      controller,
      jobTimeoutMs,
    ).finally(() => {
      if (activeJob?.jobId === job.jobId) activeJob = undefined;
    });
    activeJob = {jobId: job.jobId, controller, execution};
    void execution.catch(() => undefined);
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

  routes.set('GET /api/v1/jobs', async (_req, res) => {
    sendJson(res, {jobs: deps.jobStore.list()});
  });

  routes.set('POST /api/v1/jobs/:id/cancel', async (req, res, params) => {
    const jobId = params!.id;
    let job;
    try {
      job = deps.jobStore.get(jobId);
    } catch {
      sendError(res, 'JOB_NOT_FOUND', `job not found: ${jobId}`, 404);
      return;
    }
    if (!['pending', 'running'].includes(job.status)) {
      sendJson(res, job);
      return;
    }
    const current = activeJob;
    if (!current || current.jobId !== jobId) {
      sendError(res, 'JOB_NOT_CANCELLABLE', `job is not active: ${jobId}`, 409);
      return;
    }

    const url = new URL(req.url ?? '', 'http://localhost');
    const force = url.searchParams.get('force') === 'true';

    current.controller.abort(
      new JobAbortError('JOB_CANCELLED', 'job cancelled by client'),
    );

    const settled = await Promise.race([
      current.execution.then(() => true).catch(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000)),
    ]);

    if (!settled || force) {
      if (activeJob?.jobId === jobId) {
        activeJob = undefined;
      }
      try {
        deps.jobStore.cancel(jobId, {
          code: 'JOB_CANCELLED',
          message: 'job forcefully cancelled by client',
        });
      } catch {
        // empty
      }
    }

    sendJson(res, deps.jobStore.get(jobId));
  });

  return routes;
}

async function runJob(
  deps: ApiV1Deps,
  jobId: string,
  meta: ToolMeta,
  params: Record<string, unknown>,
  sessionId: string,
  controller: AbortController,
  timeoutMs: number,
): Promise<void> {
  deps.jobStore.markRunning(jobId);
  const timer = setTimeout(() => {
    controller.abort(
      new JobAbortError('JOB_TIMEOUT', `job timed out after ${timeoutMs}ms`),
    );
  }, timeoutMs);
  try {
    const result = await raceWithAbort(
      deps.toolAdapter.executeTool(meta, params, sessionId, controller.signal),
      controller.signal,
    );
    deps.jobStore.complete(jobId, result);
  } catch (err) {
    const e = err as {code?: string; message?: string};
    const error = {
      code: e.code ?? 'RUNTIME',
      message: e.message ?? String(err),
    };
    if (e.code === 'JOB_TIMEOUT') deps.jobStore.markTimedOut(jobId, error);
    else if (e.code === 'JOB_CANCELLED') deps.jobStore.cancel(jobId, error);
    else deps.jobStore.fail(jobId, error);
  } finally {
    clearTimeout(timer);
  }
}
