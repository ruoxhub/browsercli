/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon socket 客户端：连接/发现/自动拉起/停止 detached worker daemon。
 * 协议与 worker 侧 src/ipc/socketConnection.ts 配对：NDJSON 行协议
 * `{id, method, params}` 请求 / `{id, result}` | `{id, error}` 响应 /
 * 无 id 的推送事件。两包零耦合，下方 ~40 行帧类是有意重复，改动须两侧同步
 * （PROTOCOL_VERSION、帧格式、就绪行文本）。
 */

import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  computeClientInfo,
  deleteSession,
  loadSession,
  type SessionConfig,
} from './sessionPaths.js';

/** 与 src/ipc/socketConnection.ts 的 PROTOCOL_VERSION 同步修改 */
export const PROTOCOL_VERSION = 1;

export const DEFAULT_INVOKE_TIMEOUT_MS = 300_000;

export interface DaemonEvent {
  type?: string;
  channel?: string;
  payload?: unknown;
  ts?: number;
}

/** DaemonConnection 的鸭子类型面：命令层与测试 fake 共用（类含私有字段无法直接冒充）。 */
export interface DaemonLike {
  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
  onEvent(cb: (event: DaemonEvent) => void): () => void;
  close(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** NDJSON 帧连接。等价于 worker 侧 src/ipc/socketConnection.ts 的 SocketConnection。 */
class FrameConnection {
  private readonly socket: net.Socket;
  private readonly pendingBuffers: Buffer[] = [];

  onmessage?: (message: Record<string, unknown>) => void;
  onclose?: () => void;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', buffer => this.onData(buffer));
    socket.on('close', () => this.onclose?.());
    socket.on('error', () => {
      /* close 事件会随后触发；此处保持不抛出，行为对齐 worker 侧 */
    });
  }

  send(message: Record<string, unknown>): void {
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.socket.destroy();
  }

  private onData(buffer: Buffer): void {
    let end = buffer.indexOf('\n');
    if (end === -1) {
      this.pendingBuffers.push(buffer);
      return;
    }
    this.pendingBuffers.push(buffer.subarray(0, end));
    this.dispatch(Buffer.concat(this.pendingBuffers).toString());
    let start = end + 1;
    end = buffer.indexOf('\n', start);
    while (end !== -1) {
      this.dispatch(buffer.toString(undefined, start, end));
      start = end + 1;
      end = buffer.indexOf('\n', start);
    }
    this.pendingBuffers.length = 0;
    if (start < buffer.length) this.pendingBuffers.push(buffer.subarray(start));
  }

  private dispatch(line: string): void {
    if (!line) return;
    try {
      this.onmessage?.(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // 非法行直接丢弃：协议双方都是本仓库产物，脏数据时静默比崩溃好
    }
  }
}

export class DaemonConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly eventCbs = new Set<(event: DaemonEvent) => void>();
  private closed = false;

  private constructor(private readonly frame: FrameConnection) {
    frame.onmessage = message => this.onMessage(message);
    frame.onclose = () => this.onFrameClose();
  }

  static async connect(
    socketPath: string,
    timeoutMs = 5000,
  ): Promise<DaemonConnection> {
    const socket = net.connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`连接 daemon 超时 (${timeoutMs}ms): ${socketPath}`));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
    socket.setTimeout(0);
    return new DaemonConnection(new FrameConnection(socket));
  }

  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('daemon 连接已关闭'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求 ${method} 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.frame.send({id, method, ...(params ? {params} : {})});
    });
  }

  onEvent(cb: (event: DaemonEvent) => void): () => void {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }

  close(): void {
    this.closed = true;
    this.frame.close();
  }

  private onMessage(message: Record<string, unknown>): void {
    const id = typeof message.id === 'number' ? message.id : undefined;
    if (id !== undefined && this.pending.has(id)) {
      const entry = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (message.error) {
        const err = message.error as {code?: string; message?: string};
        entry.reject(
          new Error(
            `[${err.code ?? 'UNKNOWN'}] ${err.message ?? 'daemon 错误'}`,
          ),
        );
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (message.type) {
      const event = message as DaemonEvent;
      for (const cb of this.eventCbs) cb(event);
    }
  }

  private onFrameClose(): void {
    this.closed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('daemon 连接已断开'));
    }
    this.pending.clear();
  }
}

/** CLI 配置文件路径；PROXYCLI_CONFIG_DIR / BROWSERCLI_CONFIG_DIR 供测试隔离（与 commands/config.ts 同步）。 */
export function cliConfigPath(): string {
  const custom =
    process.env.PROXYCLI_CONFIG_DIR ?? process.env.BROWSERCLI_CONFIG_DIR;
  if (custom) return path.join(custom, 'config.json');
  const proxyDir = path.join(os.homedir(), '.proxycli');
  if (fs.existsSync(proxyDir)) return path.join(proxyDir, 'config.json');
  const browserDir = path.join(os.homedir(), '.browsercli');
  if (fs.existsSync(browserDir)) return path.join(browserDir, 'config.json');
  return path.join(proxyDir, 'config.json');
}

function loadCliConfig(): {workerEntry?: string} {
  try {
    const parsed = JSON.parse(fs.readFileSync(cliConfigPath(), 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as {workerEntry?: string};
    }
  } catch {
    // 无配置文件或损坏 → 视为空
  }
  return {};
}

export interface EnsureDaemonOptions {
  session: string;
  spawnFlags: string[];
  cwd?: string;
  /** 测试注入：覆盖按 workspace-hash 计算的注册表目录 */
  daemonDir?: string;
}

/** 解析 worker daemon 入口：env PROXYCLI_ENTRY / BROWSERCLI_ENTRY > 配置文件 workerEntry。 */
export function resolveEntryPath(): string {
  const candidates = [
    process.env.PROXYCLI_ENTRY,
    process.env.BROWSERCLI_ENTRY,
    loadCliConfig().workerEntry,
  ];
  for (const value of candidates) {
    if (value && fs.existsSync(value)) return value;
  }
  const error = new Error(
    '无法定位 worker daemon 入口（PROXYCLI_ENTRY / BROWSERCLI_ENTRY / workerEntry 均未配置或文件不存在）。',
  ) as Error & {code?: string; suggestions?: string[]};
  error.code = 'ENTRY_NOT_CONFIGURED';
  error.suggestions = [
    'proxycli config --set workerEntry=<path to build/src/index.js>',
    '或设置环境变量 PROXYCLI_ENTRY=<path to build/src/index.js>',
  ];
  throw error;
}

/** spawn detached daemon 并等待 stdout 就绪行 `Daemon listening on <socketPath>`。 */
export async function spawnDaemon(
  opts: EnsureDaemonOptions,
): Promise<SessionConfig> {
  const entry = resolveEntryPath();
  const cwd = opts.cwd ?? process.cwd();
  const info = computeClientInfo(cwd);
  const daemonDir = opts.daemonDir ?? info.daemonDir;
  await fs.promises.mkdir(daemonDir, {recursive: true});
  const errLog = path.join(daemonDir, `${opts.session}.err`);
  const err = fs.openSync(errLog, 'w');
  const child = spawn(
    process.execPath,
    [
      entry,
      '--daemon',
      '--proxycli-daemon',
      '--browsercli-daemon',
      '--session',
      opts.session,
      ...opts.spawnFlags,
    ],
    {detached: true, stdio: ['ignore', 'pipe', err], cwd, windowsHide: true},
  );
  let outLog = '';
  const ready = await new Promise<'ok' | 'exit'>(resolveP => {
    const timer = setTimeout(() => resolveP('exit'), 30_000);
    child.stdout!.on('data', d => {
      outLog += d.toString();
      if (outLog.includes('Daemon listening on')) {
        clearTimeout(timer);
        resolveP('ok');
      }
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolveP('exit');
    });
  });
  child.stdout!.destroy();
  child.unref();
  fs.closeSync(err);
  if (ready !== 'ok') {
    const errText = fs.existsSync(errLog)
      ? fs.readFileSync(errLog, 'utf-8')
      : '';
    throw new Error(
      `daemon 启动失败 (pid=${child.pid}):${outLog ? `\n${outLog}` : ''}${errText ? `\n${errText}` : ''}`,
    );
  }
  // 就绪行先于 session 文件写入（worker 侧顺序）：短暂轮询等待文件出现
  let cfg = await loadSession(daemonDir, opts.session);
  for (let i = 0; !cfg && i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    cfg = await loadSession(daemonDir, opts.session);
  }
  if (!cfg) throw new Error('daemon 就绪但 session 文件缺失');
  if (cfg.protocol !== PROTOCOL_VERSION) {
    throw new Error(
      `协议不匹配: daemon v${cfg.protocol} vs cli v${PROTOCOL_VERSION}，运行 proxycli -s=${opts.session} close 后重新 open`,
    );
  }
  return cfg;
}

/** 发现 → 探活 → 陈旧则清理并自动拉起。 */
export async function ensureDaemon(
  opts: EnsureDaemonOptions,
): Promise<SessionConfig> {
  const info = computeClientInfo(opts.cwd);
  const daemonDir = opts.daemonDir ?? info.daemonDir;
  const cfg = await loadSession(daemonDir, opts.session);
  if (cfg) {
    try {
      const conn = await DaemonConnection.connect(cfg.socketPath, 3000);
      conn.close();
      return cfg;
    } catch {
      // 陈旧注册：探活失败 → 删 session 文件后重新拉起
      await deleteSession(daemonDir, opts.session);
    }
  }
  return spawnDaemon({...opts, daemonDir});
}

/** 请求 stop；连不上视为已死；轮询 pid 探活，死了即清理 session 文件。 */
export async function stopSession(
  cfg: SessionConfig,
  daemonDir?: string,
): Promise<void> {
  try {
    const conn = await DaemonConnection.connect(cfg.socketPath, 3000);
    await conn.request('stop', undefined, 5000).catch(() => undefined);
    conn.close();
  } catch {
    // ECONNREFUSED/EOF = daemon 已死，走兜底清理
  }
  let alive = false;
  for (let i = 0; i < 10; i++) {
    try {
      process.kill(cfg.pid, 0);
      alive = true;
    } catch {
      alive = false;
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!alive) {
    const dir =
      daemonDir ??
      (cfg.workspaceDir
        ? computeClientInfo(cfg.workspaceDir).daemonDir
        : undefined);
    if (dir) await deleteSession(dir, cfg.name);
  }
}

/** 从 ps/进程列表行提取 daemon pid：须同时含 node 进程特征与 --proxycli-daemon / --browsercli-daemon，排除 grep 自身。 */
export function collectDaemonPids(lines: string[]): number[] {
  const result: number[] = [];
  for (const line of lines) {
    if (
      !line.includes('--proxycli-daemon') &&
      !line.includes('--browsercli-daemon')
    )
      continue;
    // 排除查询进程自身（grep/powershell/taskkill 命令行里也含该字符串）
    if (/\b(grep|powershell|taskkill)\b/i.test(line)) continue;
    const first = line.trim().split(/\s+/)[0];
    const pid = Number(first);
    if (Number.isInteger(pid) && pid > 0) result.push(pid);
  }
  return result;
}

/** 强杀全部 daemon，返回被杀 pid 列表。 */
export async function killAllDaemons(): Promise<number[]> {
  let pids: number[];
  if (process.platform === 'win32') {
    // 用 SystemRoot 全路径解析 powershell.exe：WindowsPowerShell\v1.0 不在某些
    // 精简环境的 PATH 里时，裸命令名会 spawnSync ENOENT（SystemRoot 必存在）。
    const powershellExe = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const out = execFileSync(
      powershellExe,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--proxycli-daemon*' -or $_.CommandLine -like '*--browsercli-daemon*' } | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }",
      ],
      {encoding: 'utf-8'},
    );
    pids = collectDaemonPids(out.split(/\r?\n/));
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/F'], {
          stdio: 'ignore',
        });
      } catch {
        // 已退出的进程忽略
      }
    }
  } else {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], {encoding: 'utf-8'});
    pids = collectDaemonPids(out.split('\n'));
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 已退出的进程忽略
      }
    }
  }
  return pids;
}
