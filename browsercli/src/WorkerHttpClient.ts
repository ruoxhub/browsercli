/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';

import type {ToolMeta} from './tool-meta-types.js';

const STREAM_CHANNELS = [
  'tool.invoke',
  'hook.event',
  'hook.sample',
  'log',
] as const;

function isWorkerBusyError(err: unknown): boolean {
  return err instanceof Error && /WORKER_BUSY/.test(err.message);
}

export interface ToolRecovery {
  tool?: string;
  command?: string;
  reason: string;
}

export interface WorkerHttpClientOptions {
  baseUrl: string; // 默认 http://127.0.0.1:8765
  apiToken?: string;
  timeoutMs?: number; // 默认 300000
  pollIntervalMs?: number; // 默认 300
  busyRetryDelaysMs?: number[]; // WORKER_BUSY 退避序列，默认 [200, 500, 1000]
}

export interface JobStatus {
  jobId: string;
  sessionId: string;
  tool?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'timed_out' | 'cancelled';
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    recovery?: ToolRecovery;
    details?: Record<string, unknown>;
  };
  logs: string[];
  createdAt: string;
  finishedAt?: string;
}

export type BrowserConnectionMode =
  | 'attach'
  | 'ws-endpoint'
  | 'launch'
  | 'disconnected';

export interface BrowserConnectionStatus {
  connected: boolean;
  mode: BrowserConnectionMode;
  pages: number;
}

export interface BrowserConnectOptions {
  acceptInsecureCerts?: boolean;
  browserURL?: string;
  channel?: string;
  cloak?: boolean;
  executablePath?: string;
  fullStealthArgs?: boolean;
  headless?: boolean;
  isolated?: boolean;
  jsStealth?: boolean;
  minimalStealth?: boolean;
  userDataDir?: string;
  viewport?: {width: number; height: number};
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
}

export interface BrowserDisconnectOptions {
  force?: boolean;
}

export class WorkerHttpClient {
  readonly baseUrl: string;
  private readonly apiToken?: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly busyRetryDelaysMs: number[];
  private cachedSessionId?: string;

  constructor(opts: WorkerHttpClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
    this.apiToken = opts.apiToken;
    this.timeoutMs = opts.timeoutMs ?? 300000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 300;
    this.busyRetryDelaysMs = opts.busyRetryDelaysMs ?? [200, 500, 1000];
  }

  /** 进程内懒建并缓存 session，多次 invoke 复用，仅首次付 1 RTT */
  async ensureSession(explicitId?: string): Promise<string> {
    if (explicitId) return explicitId;
    if (this.cachedSessionId) return this.cachedSessionId;
    const s = await this.createSession();
    this.cachedSessionId = s.sessionId;
    return s.sessionId;
  }

  private authHeader(): Record<string, string> {
    return this.apiToken ? {authorization: `Bearer ${this.apiToken}`} : {};
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs),
      headers: {...this.authHeader(), ...(init?.headers ?? {})},
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${raw}`);
    }
    // 服务端统一信封：{ success, data, error }。解包 data，并把 success:false 转为异常。
    let parsed: {
      success?: boolean;
      data?: T;
      error?: {code?: string; message?: string};
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `非 JSON 响应 (HTTP ${res.status}): ${raw.slice(0, 200)}`,
      );
    }
    if (parsed && parsed.success === false) {
      const err = parsed.error;
      throw new Error(
        `Worker 错误 ${err?.code ?? 'UNKNOWN'}: ${err?.message ?? raw.slice(0, 200)}`,
      );
    }
    return (parsed?.data ?? (parsed as unknown as T)) as T;
  }

  async health(): Promise<{status: string}> {
    return this.json('/health');
  }
  async getBrowserStatus(): Promise<BrowserConnectionStatus> {
    return this.json('/browser/status');
  }

  async connectBrowser(
    options: BrowserConnectOptions = {},
  ): Promise<BrowserConnectionStatus> {
    return this.json('/browser/connect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(options),
    });
  }

  async disconnectBrowser(
    options: BrowserDisconnectOptions = {},
  ): Promise<BrowserConnectionStatus> {
    return this.json('/browser/disconnect', {
      method: 'POST',
      ...(options.force === undefined
        ? {}
        : {
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({force: options.force}),
          }),
    });
  }
  async listTools(): Promise<{tools: ToolMeta[]}> {
    // 服务端契约为 { tools: ToolMeta[] }；但 CLI 与 worker 独立版本化，
    // 旧版本/代理可能直接返回数组或省略 data 字段。此处归一化，避免调用方
    // 在 undefined 上执行 .find/.map 而崩溃（报 "reading 'find'" 类错误）。
    const payload = await this.json<{tools?: unknown[]}>('/tools');
    const rawTools = Array.isArray(payload) ? payload : (payload?.tools ?? []);
    return {tools: rawTools as ToolMeta[]};
  }
  async getTool(name: string): Promise<unknown> {
    return this.json(`/tools/${encodeURIComponent(name)}`);
  }
  async createSession(): Promise<{sessionId: string; createdAt: string}> {
    return this.json('/sessions', {method: 'POST'});
  }
  async listSessions(): Promise<{sessions: unknown[]}> {
    return this.json('/sessions');
  }
  async deleteSession(id: string): Promise<{deleted: boolean}> {
    return this.json(`/sessions/${encodeURIComponent(id)}`, {method: 'DELETE'});
  }

  /** 底层原语：提交 Job，返回 jobId */
  async submitInvoke(
    sessionId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.json<{jobId: string}>(
      `/sessions/${encodeURIComponent(sessionId)}/invoke`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tool, params}),
      },
    );
    return res.jobId;
  }

  private async submitInvokeWithBusyRetry(
    sessionId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const delays = this.busyRetryDelaysMs;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.submitInvoke(sessionId, tool, params);
      } catch (err) {
        if (attempt < delays.length && isWorkerBusyError(err)) {
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
        throw err;
      }
    }
  }

  async getJob(jobId: string): Promise<JobStatus> {
    return this.json<JobStatus>(`/jobs/${encodeURIComponent(jobId)}`);
  }

  async listJobs(): Promise<{jobs: JobStatus[]}> {
    return this.json<{jobs: JobStatus[]}>('/jobs');
  }

  async cancelJob(jobId: string): Promise<JobStatus> {
    return this.json<JobStatus>(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
  }

  /** request-response 封装：提交 + 轮询至终态，返回 result 或抛 error。
   *  首轮第 0ms 立即查，避免空等一个 pollInterval。 */
  async invoke(
    sessionId: string | undefined,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const sid = await this.ensureSession(sessionId);
    const jobId = await this.submitInvokeWithBusyRetry(sid, tool, params);
    const deadline = Date.now() + this.timeoutMs;
    // 首轮立即查
    let job = await this.getJob(jobId);
    while (job.status === 'pending' || job.status === 'running') {
      if (Date.now() > deadline) {
        try {
          await this.cancelJob(jobId);
        } catch {
          // The deadline error remains primary; jobs cancel can be retried manually.
        }
        throw new Error(
          `invoke timeout after ${this.timeoutMs}ms (job ${jobId} status=${job.status})`,
        );
      }
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
      job = await this.getJob(jobId);
    }
    if (job.status !== 'done') {
      const code = job.error?.code ?? job.status;
      const message = job.error?.message ?? `job ${job.status}`;
      const recoveryCmd = job.error?.recovery?.command
        ? ` (recovery: ${job.error.recovery.command})`
        : job.error?.recovery?.tool
          ? ` (recovery: tool ${job.error.recovery.tool})`
          : job.error?.recovery?.reason
            ? ` (recovery: ${job.error.recovery.reason})`
            : '';
      throw new Error(`[${code}] ${message}${recoveryCmd}`);
    }
    return job.result;
  }

  /** 订阅会话事件流（hook.sample / tool.invoke / log），返回取消函数 */
  async openStream(
    sessionId: string | undefined,
    onEvent: (event: unknown) => void,
  ): Promise<() => void> {
    const sid = await this.ensureSession(sessionId);
    const ws = new WebSocket(
      `${this.baseUrl.replace(/^http/, 'ws')}/api/v1/sessions/${encodeURIComponent(sid)}/stream`,
      this.apiToken
        ? {headers: {authorization: `Bearer ${this.apiToken}`}}
        : undefined,
    );
    ws.on('message', data => {
      try {
        onEvent(JSON.parse(data.toString()));
      } catch {
        // ignore non-JSON
      }
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        try {
          for (const channel of STREAM_CHANNELS) {
            ws.send(JSON.stringify({type: 'subscribe', channel}));
          }
          resolve();
        } catch (error) {
          ws.close();
          reject(error);
        }
      });
      ws.on('error', reject);
    });
    return () => ws.close();
  }
}
