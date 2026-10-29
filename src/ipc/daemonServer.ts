/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 端 socket 服务：在本地命名管道（POSIX 为 unix socket）上提供
 * NDJSON 方法分发（tools/browser/jobs/events），替代原 /api/v1 HTTP 传输。
 * 客户端见 browsercli/src/daemonClient.ts，帧协议见 ./socketConnection.ts。
 */

import fs from 'node:fs';
import net from 'node:net';

import {BrowserConfigInvariantError} from '../config/browserInvariants.js';
import type {ToolMeta} from '../tools/tools-meta.js';
import type {ToolRecovery} from '../utils/errors.js';
import {
  connectBrowser,
  disconnectBrowser,
  getBrowserConnectionStatus,
} from '../worker/BrowserConnectionManager.js';
import {
  BrowserConfigRequestError,
  candidateBrowserConfig,
  effectiveBrowserConfig,
  parseBrowserConnectBody,
  parseBrowserDisconnectBody,
} from '../worker/browserRequests.js';
import type {JobStore} from '../worker/JobStore.js';
import type {ToolAdapter} from '../worker/ToolAdapter.js';
import type {ToolContextProvider} from '../worker/ToolContext.js';
import {
  raceWithAbort,
  WorkerBusyError,
  workerActivityCoordinator,
} from '../worker/WorkerActivityCoordinator.js';

import type {Channel, MinimalWebSocket, WsHub} from './eventHub.js';
import {PROTOCOL_VERSION, SocketConnection} from './socketConnection.js';

export interface DaemonDeps {
  sessionName: string;
  version: string;
  startedAt: number;
  contextProvider: ToolContextProvider;
  toolAdapter: Pick<ToolAdapter, 'executeTool'>;
  jobStore: JobStore;
  wsHub: WsHub;
  listToolsMeta: () => ToolMeta[];
  getToolMeta: (name: string) => ToolMeta | undefined;
  /** stop 方法触发：删 session 文件 + 关监听，由调用方退出进程。 */
  onStop: () => Promise<void>;
}

export interface DaemonHandle {
  socketPath: string;
  close: () => Promise<void>;
}

export interface DaemonStatusResult {
  version: string;
  protocol: number;
  pid: number;
  session: string;
  socketPath: string;
  startDate: string;
  uptimeMs: number;
  args: string[];
}

interface ActiveJob {
  jobId: string;
  controller: AbortController;
  execution: Promise<void>;
  ownerConn?: SocketConnection;
}

type JobAbortCode = 'JOB_CANCELLED';

class JobAbortError extends Error {
  constructor(
    readonly code: JobAbortCode,
    message: string,
  ) {
    super(message);
  }
}

/** 把 ws 文本帧转成 socket NDJSON 帧，供 WsHub 直接推送给 daemon 客户端。 */
class SocketWsAdapter implements MinimalWebSocket {
  readyState = 1;

  constructor(private readonly conn: SocketConnection) {}

  send(data: string): void {
    try {
      void this.conn.send(JSON.parse(data) as object).catch(() => undefined);
    } catch {
      // WsHub 只会 send 自己序列化的 JSON，解析失败视为不可恢复的脏帧
    }
  }
}

function busyError(
  activeJobId: string | undefined,
  state: {activeTools: number; browserOperation?: string},
): Error & {code: string; state: unknown} {
  const message = activeJobId
    ? `worker is busy with job ${activeJobId}`
    : state.browserOperation
      ? `worker is busy with browser ${state.browserOperation}`
      : 'worker is busy running tools';
  return Object.assign(new Error(message), {
    code: 'WORKER_BUSY',
    state: activeJobId
      ? {jobId: activeJobId}
      : state.browserOperation
        ? {operation: state.browserOperation}
        : {activeTools: state.activeTools},
  });
}

/** 忙判定语义与原 HTTP apiV1 rejectIfBusy 一致（409 → 抛错带 WORKER_BUSY）。 */
function rejectIfBusy(
  operation: 'tool' | 'browser',
  activeJob?: ActiveJob,
): void {
  const activity = workerActivityCoordinator.getState();
  const busyWithBrowser = activity.browserOperation !== undefined;
  const busyWithTool = activeJob !== undefined || activity.activeTools > 0;
  const busy =
    busyWithBrowser ||
    (operation === 'browser' && busyWithTool) ||
    (operation === 'tool' && activeJob !== undefined);
  if (busy) {
    throw busyError(activeJob?.jobId, activity);
  }
}

/** 中止活动 job 并等待其结算（最多 1s）；超时或 force 时强制收尾。 */
async function abortActiveJob(
  getJob: () => ActiveJob | undefined,
  clearJob: (jobId: string) => void,
  jobStore: JobStore,
  force: boolean,
  reason: string,
): Promise<void> {
  const current = getJob();
  if (!current) return;
  current.controller.abort(new JobAbortError('JOB_CANCELLED', reason));
  const settled = await Promise.race([
    current.execution.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000)),
  ]);
  if (!settled || force) {
    clearJob(current.jobId);
    try {
      jobStore.cancel(current.jobId, {
        code: 'JOB_CANCELLED',
        message: 'job forcefully cancelled by client',
      });
    } catch {
      // 已结算的 job 忽略二次 finalize
    }
  }
}

export async function startDaemonServer(
  deps: DaemonDeps,
  socketPath: string,
): Promise<DaemonHandle> {
  if (process.platform !== 'win32') {
    await fs.promises.unlink(socketPath).catch(() => undefined);
  }
  let activeJob: ActiveJob | undefined;
  const liveSockets = new Set<net.Socket>();
  const clearActiveJob = (jobId: string) => {
    if (activeJob?.jobId === jobId) activeJob = undefined;
  };
  const getActiveJob = () => activeJob;

  const server = net.createServer(raw => {
    liveSockets.add(raw);
    raw.once('close', () => liveSockets.delete(raw));
    const conn = new SocketConnection(raw);
    const adapter = new SocketWsAdapter(conn);
    conn.onclose = () => {
      adapter.readyState = 0;
      deps.wsHub.handleDisconnect(adapter);
      if (activeJob && activeJob.ownerConn === conn) {
        activeJob.controller.abort(
          new JobAbortError('JOB_CANCELLED', 'client disconnected'),
        );
      }
    };
    conn.onmessage = async message => {
      const {id, method, params} = message as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (typeof id !== 'number' || typeof method !== 'string') return;
      try {
        const result = await dispatch(conn, adapter, method, params ?? {});
        await conn.send({id, result});
      } catch (error) {
        const err = error as {code?: string; message?: string};
        await conn
          .send({
            id,
            error: {
              code: toErrorCode(err),
              message: err.message ?? String(error),
              ...('state' in err
                ? {details: (err as {state: unknown}).state}
                : {}),
            },
          })
          .catch(() => undefined);
      }
    };
  });

  function toErrorCode(err: {code?: string; message?: string}): string {
    if (err.code) return err.code;
    if (err.message === 'JOB_NOT_FOUND') return 'JOB_NOT_FOUND';
    return 'INTERNAL';
  }

  async function dispatch(
    conn: SocketConnection,
    adapter: SocketWsAdapter,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'status':
      case 'hello':
        return {
          version: deps.version,
          protocol: PROTOCOL_VERSION,
          pid: process.pid,
          session: deps.sessionName,
          socketPath,
          startDate: new Date(deps.startedAt).toISOString(),
          uptimeMs: Date.now() - deps.startedAt,
          args: process.argv.slice(2),
        } satisfies DaemonStatusResult;
      case 'tools.list':
        return {tools: deps.listToolsMeta()};
      case 'tool.invoke':
        return await handleToolInvoke(conn, params);
      case 'browser.status':
        return getBrowserConnectionStatus(
          deps.contextProvider,
          effectiveBrowserConfig(),
        );
      case 'browser.connect':
        return await handleBrowserConnect(params);
      case 'browser.disconnect':
        return await handleBrowserDisconnect(params);
      case 'jobs.list':
        return {jobs: deps.jobStore.list()};
      case 'jobs.cancel':
        return await handleJobsCancel(params);
      case 'subscribe': {
        const channels = Array.isArray(params.channels)
          ? (params.channels as string[])
          : [];
        for (const channel of channels) {
          deps.wsHub.subscribe(adapter, channel as Channel);
        }
        return {subscribed: channels};
      }
      case 'stop':
        queueMicrotask(() => void deps.onStop().catch(() => undefined));
        return 'ok';
      default:
        throw Object.assign(new Error(`unknown method: ${method}`), {
          code: 'UNKNOWN_METHOD',
        });
    }
  }

  async function handleToolInvoke(
    conn: SocketConnection,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const tool = params.tool;
    if (!tool || typeof tool !== 'string') {
      throw Object.assign(new Error('body.tool (string) is required'), {
        code: 'VALIDATION',
      });
    }
    const meta = deps.getToolMeta(tool);
    if (!meta) {
      throw Object.assign(new Error(`tool not found: ${tool}`), {
        code: 'TOOL_NOT_FOUND',
      });
    }
    rejectIfBusy('tool', getActiveJob());
    const toolParams = (params.params as Record<string, unknown>) ?? {};
    let job;
    try {
      job = deps.jobStore.create(deps.sessionName, tool, toolParams);
    } catch (error) {
      if (error instanceof Error && error.message === 'JOB_STORE_FULL') {
        throw Object.assign(
          new Error(
            'too many active jobs; retry after an existing job finishes',
          ),
          {code: 'JOB_STORE_FULL'},
        );
      }
      throw error;
    }
    const controller = new AbortController();
    const execution = runJob(deps, job.jobId, meta, toolParams, controller)
      .catch(() => undefined)
      .finally(() => clearActiveJob(job.jobId));
    activeJob = {jobId: job.jobId, controller, execution, ownerConn: conn};
    await execution;
    const final = deps.jobStore.get(job.jobId);
    if (final.status !== 'done') {
      throw Object.assign(new Error(final.error?.message ?? 'job failed'), {
        code: final.error?.code ?? 'RUNTIME',
      });
    }
    return final.result;
  }

  async function handleBrowserConnect(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const rawBody = (params.body ?? params.options ?? {}) as Record<
      string,
      unknown
    >;
    const force = rawBody.force === true || params.force === true;
    let patch;
    try {
      const {force: _ignoredForce, ...cleanBody} = rawBody;
      patch = parseBrowserConnectBody(cleanBody);
    } catch (error) {
      if (error instanceof BrowserConfigRequestError) throw error;
      throw error;
    }
    rejectIfBusy('browser', getActiveJob());
    // 先算候选、校验，再提交（B1）。`RuntimeConfigStore.update()` 深合并
    // `browser`，所以上一次请求留下的字段会活到这一次：两个各自合法的请求
    // `connect --ego --keep-page` → `connect --ego=false` 会让 store 停在
    // `{ego:false, keepPage:true}`。若先提交再校验，那条不变量会抛出，store 却
    // 已经脏了 —— 之后**每个** `browser.status` / `browser.disconnect` 都会跟着
    // 抛，daemon 被永久卡死。校验放在写入之前，被拒绝的请求不留痕迹。
    //
    // 候选与提交都在连接的那个 try 之外：不变量错误（如 BROWSER_KEEP_PAGE 单独
    // 存在且本次请求也没给 ego）必须原样上报成 VALIDATION，不能被下面的
    // `BROWSER_CONNECT_FAILED` 折掉 —— 那时连接根本还没开始。
    const {commit, config} = candidateBrowserConfig(patch);
    try {
      commit();
    } catch (error) {
      // 写 store 失败也不是连接失败：连接压根没尝试，用户需要知道是配置没写
      // 进去，而不是「浏览器起不来」。
      throw Object.assign(new Error('failed to persist browser config'), {
        code: 'BROWSER_CONFIG_COMMIT_FAILED',
        cause: error,
      });
    }
    try {
      await connectBrowser(deps.contextProvider, config, {force});
      const status = getBrowserConnectionStatus(deps.contextProvider, config);
      deps.wsHub.broadcast('worker.status', {browser: status});
      return status;
    } catch (error) {
      if (error instanceof WorkerBusyError) throw error;
      // Keep the original message: the bridge's diagnostics ("ego lite binary
      // not found at <paths>", "could not enter a task space ... after 8
      // attempts", a CDP method ego does not implement) are the only thing that
      // tells a user what to do next. Folding them into one sentence is how a
      // well-diagnosed failure becomes an unexplained one.
      const detail = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`failed to connect browser: ${detail}`), {
        code: 'BROWSER_CONNECT_FAILED',
        cause: error,
      });
    }
  }

  async function handleBrowserDisconnect(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const force = parseBrowserDisconnectBody(
      (params.body as Record<string, unknown>) ?? {},
    );
    if (!force) rejectIfBusy('browser', getActiveJob());
    try {
      await abortActiveJob(
        getActiveJob,
        clearActiveJob,
        deps.jobStore,
        force,
        'job cancelled by browser disconnect',
      );
      await disconnectBrowser(deps.contextProvider, {force});
      const status = getBrowserConnectionStatus(
        deps.contextProvider,
        effectiveBrowserConfig(),
      );
      deps.wsHub.broadcast('worker.status', {browser: status});
      return status;
    } catch (error) {
      if (error instanceof WorkerBusyError) throw error;
      // 与 `handleBrowserConnect` 同一条理由：生效配置自相矛盾时，把
      // BrowserConfigInvariantError 折成 BROWSER_DISCONNECT_FAILED 就等于把
      // 唯一的诊断信息换成一句"断开浏览器失败"，用户无从知道该改哪个配置。
      if (error instanceof BrowserConfigInvariantError) throw error;
      throw Object.assign(new Error('failed to disconnect browser'), {
        code: 'BROWSER_DISCONNECT_FAILED',
      });
    }
  }

  async function handleJobsCancel(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const jobId = String(params.jobId ?? '');
    let job;
    try {
      job = deps.jobStore.get(jobId);
    } catch {
      throw Object.assign(new Error(`job not found: ${jobId}`), {
        code: 'JOB_NOT_FOUND',
      });
    }
    if (!['pending', 'running'].includes(job.status)) return job;
    const current = getActiveJob();
    if (!current || current.jobId !== jobId) {
      throw Object.assign(new Error(`job is not active: ${jobId}`), {
        code: 'JOB_NOT_CANCELLABLE',
      });
    }
    const force = params.force === true;
    await abortActiveJob(
      getActiveJob,
      clearActiveJob,
      deps.jobStore,
      force,
      'job cancelled by client',
    );
    return deps.jobStore.get(jobId);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  return {
    socketPath,
    close: async () => {
      for (const socket of liveSockets) {
        socket.destroy();
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (process.platform !== 'win32') {
        await fs.promises.unlink(socketPath).catch(() => undefined);
      }
    },
  };
}

/**
 * 单次 job 执行：busy 已由调用方判定，此处只负责状态流转与错误归一化。
 * 与 apiV1 runJob 一致，daemon 侧不挂超时 timer，超时由客户端请求层负责。
 */
async function runJob(
  deps: DaemonDeps,
  jobId: string,
  meta: ToolMeta,
  params: Record<string, unknown>,
  controller: AbortController,
): Promise<void> {
  deps.jobStore.markRunning(jobId);
  try {
    const result = await raceWithAbort(
      deps.toolAdapter.executeTool(
        meta,
        params,
        deps.sessionName,
        controller.signal,
      ),
      controller.signal,
    );
    deps.jobStore.complete(jobId, result);
  } catch (err) {
    const e = err as {
      code?: string;
      message?: string;
      retryable?: boolean;
      recovery?: ToolRecovery;
      details?: Record<string, unknown>;
    };
    const error = {
      code: e.code ?? 'RUNTIME',
      message: e.message ?? String(err),
      ...(e.retryable !== undefined ? {retryable: e.retryable} : {}),
      ...(e.recovery !== undefined ? {recovery: e.recovery} : {}),
      ...(e.details !== undefined ? {details: e.details} : {}),
    };
    if (e.code === 'JOB_CANCELLED') deps.jobStore.cancel(jobId, error);
    else deps.jobStore.fail(jobId, error);
  }
}
