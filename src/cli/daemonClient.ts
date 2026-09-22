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
import {fileURLToPath} from 'node:url';

import {
  computeClientInfo,
  deleteSession,
  loadSession,
  type SessionConfig,
} from './sessionPaths.js';

/** 与 src/ipc/socketConnection.ts 的 PROTOCOL_VERSION 同步修改 */
export const PROTOCOL_VERSION = 1;

export function readPackageVersion(): string {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as {
            version?: string;
          };
          if (typeof parsed.version === 'string') return parsed.version;
        } catch {
          // ignore
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // ignore
  }
  return '2.0.3';
}

export const CLI_VERSION = readPackageVersion();

export const DEFAULT_INVOKE_TIMEOUT_MS = 300_000;

export interface DaemonEvent {
  type?: string;
  channel?: string;
  payload?: unknown;
  ts?: number;
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

/** CLI 配置文件路径；BROWSERCLI_CONFIG_DIR / PROXYCLI_CONFIG_DIR 供测试隔离（与 commands/config.ts 同步）。 */
export function cliConfigPath(): string {
  const custom =
    process.env.BROWSERCLI_CONFIG_DIR ?? process.env.PROXYCLI_CONFIG_DIR;
  if (custom) return path.join(custom, 'config.json');
  const browserDir = path.join(os.homedir(), '.browsercli');
  if (fs.existsSync(browserDir)) return path.join(browserDir, 'config.json');
  const proxyDir = path.join(os.homedir(), '.proxycli');
  if (fs.existsSync(proxyDir)) return path.join(proxyDir, 'config.json');
  return path.join(browserDir, 'config.json');
}

export interface CliConfig {
  workerEntry?: string;
  headless?: string;
  cloak?: string;
  jsStealth?: string;
  fullStealthArgs?: string;
  minimalStealth?: string;
  browserUrl?: string;
  wsEndpoint?: string;
  executablePath?: string;
}

export function loadCliConfig(): CliConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(cliConfigPath(), 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CliConfig;
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

/** 跨平台（Windows / WSL）规范化候选路径：在 Linux 下尝试将 Windows 盘符路径（如 D:/...）转为 /mnt/d/...，反之亦然。 */
export function normalizeCandidatePath(rawPath?: string): string | undefined {
  if (!rawPath) return undefined;
  if (fs.existsSync(rawPath)) return rawPath;
  if (process.platform === 'linux') {
    const winMatch = rawPath.match(/^([A-Za-z]):[/\\](.*)/);
    if (winMatch) {
      const wslPath = `/mnt/${winMatch[1].toLowerCase()}/${winMatch[2].replaceAll('\\', '/')}`;
      if (fs.existsSync(wslPath)) return wslPath;
    }
  } else if (process.platform === 'win32') {
    const wslMatch = rawPath.match(/^\/mnt\/([A-Za-z])\/(.*)/);
    if (wslMatch) {
      const winPath = `${wslMatch[1].toUpperCase()}:\\${wslMatch[2].replaceAll('/', '\\')}`;
      if (fs.existsSync(winPath)) return winPath;
    }
  }
  return undefined;
}

/** 解析 worker daemon 入口：env BROWSERCLI_ENTRY / PROXYCLI_ENTRY > 配置文件 workerEntry。 */
export function resolveEntryPath(): string {
  const candidates = [
    process.env.BROWSERCLI_ENTRY,
    process.env.PROXYCLI_ENTRY,
    loadCliConfig().workerEntry,
  ];
  for (const raw of candidates) {
    const normalized = normalizeCandidatePath(raw);
    if (normalized) return normalized;
  }
  const error = new Error(
    '无法定位 worker daemon 入口（BROWSERCLI_ENTRY / PROXYCLI_ENTRY / workerEntry 均未配置或文件不存在）。',
  ) as Error & {code?: string; suggestions?: string[]};
  error.code = 'ENTRY_NOT_CONFIGURED';
  error.suggestions = [
    'browsercli config --set workerEntry=<path to build/src/index.js>',
    '或设置环境变量 BROWSERCLI_ENTRY / PROXYCLI_ENTRY=<path to build/src/index.js>',
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
  await fs.promises.mkdir(daemonDir, {recursive: true, mode: 0o700});
  const errLog = path.join(daemonDir, `${opts.session}.err`);
  const err = fs.openSync(errLog, 'w');
  const child = spawn(
    process.execPath,
    [
      entry,
      '--daemon',
      '--browsercli-daemon',
      '--session',
      opts.session,
      ...opts.spawnFlags,
    ],
    {detached: true, stdio: ['ignore', 'pipe', err], cwd, windowsHide: true},
  );
  let outLog = '';
  let pollTimer: NodeJS.Timeout | undefined;
  const pollSession = new Promise<'ok'>(resolvePoll => {
    pollTimer = setInterval(async () => {
      const c = await loadSession(daemonDir, opts.session);
      if (c && isPidAlive(c.pid)) {
        try {
          const conn = await DaemonConnection.connect(c.socketPath, 300);
          conn.close();
          clearInterval(pollTimer);
          resolvePoll('ok');
        } catch {
          // 正在启动中
        }
      }
    }, 100);
  });

  const ready = await Promise.race([
    new Promise<'ok' | 'exit'>(resolveP => {
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
    }),
    pollSession,
  ]);
  if (pollTimer) clearInterval(pollTimer);
  child.stdout!.destroy();
  child.unref();
  fs.closeSync(err);
  if (ready !== 'ok') {
    if (child.pid) killPidForce(child.pid);
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
      `协议不匹配: daemon v${cfg.protocol} vs cli v${PROTOCOL_VERSION}，运行 browsercli -s=${opts.session} close 后重新 open`,
    );
  }
  return cfg;
}

/** 检查系统进程列表中指定 PID 是否仍存活。 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 跨平台强杀指定 PID 的进程。 */
export function killPidForce(pid: number): void {
  if (!isPidAlive(pid)) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/F'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // 忽略进程退出竞争或无权限
  }
}

/** 发现 → 探活 → 陈旧则清理并自动拉起（带跨进程并发互斥锁防重）。 */
export async function ensureDaemon(
  opts: EnsureDaemonOptions,
): Promise<SessionConfig> {
  const info = computeClientInfo(opts.cwd);
  const daemonDir = opts.daemonDir ?? info.daemonDir;

  // 1. 尝试直接复用已有正常会话
  const cfg = await loadSession(daemonDir, opts.session);
  if (cfg) {
    try {
      const conn = await DaemonConnection.connect(cfg.socketPath, 3000);
      conn.close();
      return cfg;
    } catch {
      // 陈旧注册：探活失败。若旧进程仍然存活，强杀它避免变成孤儿 daemon
      if (cfg.pid && cfg.pid !== process.pid && isPidAlive(cfg.pid)) {
        killPidForce(cfg.pid);
      }
      await deleteSession(daemonDir, opts.session);
    }
  }

  // 2. 避免并发命令同时拉起多个 daemon：基于 session 的启动锁
  await fs.promises.mkdir(daemonDir, {recursive: true, mode: 0o700});
  const lockFile = path.join(daemonDir, `${opts.session}.spawn.lock`);

  const acquireLock = async (): Promise<() => void> => {
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      try {
        const fd = fs.openSync(lockFile, 'wx');
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}`);
        fs.closeSync(fd);
        return () => {
          try {
            fs.unlinkSync(lockFile);
          } catch {
            // ignore
          }
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // 检查锁是否过期（持有者已死，或超时 35s）
          try {
            const content = fs.readFileSync(lockFile, 'utf-8');
            const [pidStr, tsStr] = content.split('\n');
            const lockPid = Number(pidStr);
            const lockTs = Number(tsStr);
            if (
              (lockPid && !isPidAlive(lockPid)) ||
              (lockTs && Date.now() - lockTs > 35_000)
            ) {
              try {
                fs.unlinkSync(lockFile);
              } catch {
                // ignore
              }
              continue;
            }
          } catch {
            // ignore
          }

          // 等待期间检查是否有其他并发 CLI 已经成功启动了 daemon
          const existing = await loadSession(daemonDir, opts.session);
          if (existing) {
            try {
              const conn = await DaemonConnection.connect(
                existing.socketPath,
                3000,
              );
              conn.close();
              throw {reusedConfig: existing};
            } catch (probeErr) {
              if ((probeErr as {reusedConfig?: SessionConfig}).reusedConfig) {
                throw probeErr;
              }
            }
          }

          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`等待 daemon 启动锁超时 (${lockFile})`);
  };

  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = await acquireLock();
  } catch (lockErr) {
    if ((lockErr as {reusedConfig?: SessionConfig}).reusedConfig) {
      return (lockErr as {reusedConfig: SessionConfig}).reusedConfig;
    }
    throw lockErr;
  }

  try {
    // 抢到锁后二次检查，防止在此期间已有可用会话
    const doubleCheck = await loadSession(daemonDir, opts.session);
    if (doubleCheck) {
      try {
        const conn = await DaemonConnection.connect(
          doubleCheck.socketPath,
          3000,
        );
        conn.close();
        return doubleCheck;
      } catch {
        if (
          doubleCheck.pid &&
          doubleCheck.pid !== process.pid &&
          isPidAlive(doubleCheck.pid)
        ) {
          killPidForce(doubleCheck.pid);
        }
        await deleteSession(daemonDir, opts.session);
      }
    }

    return await spawnDaemon({...opts, daemonDir});
  } finally {
    releaseLock?.();
  }
}

/** 请求 stop；连不上视为已死；轮询 pid 探活，超时强杀并清理 session 文件。 */
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
    alive = isPidAlive(cfg.pid);
    if (!alive) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (alive) {
    killPidForce(cfg.pid);
  }
  const dir =
    daemonDir ??
    (cfg.workspaceDir
      ? computeClientInfo(cfg.workspaceDir).daemonDir
      : undefined);
  if (dir) await deleteSession(dir, cfg.name);
}

/** 从 ps/进程列表行提取 daemon pid：须同时含 node 进程特征与 --browsercli-daemon / --proxycli-daemon，排除 grep 自身。 */
export function collectDaemonPids(lines: string[]): number[] {
  const result: number[] = [];
  for (const line of lines) {
    if (
      !line.includes('--browsercli-daemon') &&
      !line.includes('--proxycli-daemon')
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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--browsercli-daemon*' -or $_.CommandLine -like '*--proxycli-daemon*' } | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }",
      ],
      {encoding: 'utf-8'},
    );
    pids = collectDaemonPids(out.split(/\r?\n/));
    for (const pid of pids) {
      killPidForce(pid);
    }
  } else {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], {encoding: 'utf-8'});
    pids = collectDaemonPids(out.split('\n'));
    for (const pid of pids) {
      killPidForce(pid);
    }
  }
  return pids;
}

/**
 * 检查指定会话的 daemon 是否正在运行并存活（结合 session 注册与 socket 探活）。
 * 对齐 chrome-devtools-mcp 的 isDaemonRunning。
 */
export async function isDaemonRunning(
  session: string,
  daemonDir?: string,
): Promise<boolean> {
  const dir = daemonDir ?? computeClientInfo().daemonDir;
  const cfg = await loadSession(dir, session);
  if (!cfg) return false;
  if (!isPidAlive(cfg.pid)) return false;
  try {
    const conn = await DaemonConnection.connect(cfg.socketPath, 500);
    conn.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * 轮询等待 daemon 就绪（基于 session 文件生成与 socket 探活响应）。
 * 对齐 chrome-devtools-mcp 的 waitForDaemonReady。
 */
export async function waitForDaemonReady(
  session: string,
  daemonDir?: string,
  timeoutMs = 15_000,
): Promise<SessionConfig> {
  const dir = daemonDir ?? computeClientInfo().daemonDir;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const cfg = await loadSession(dir, session);
      if (cfg && isPidAlive(cfg.pid)) {
        const conn = await DaemonConnection.connect(cfg.socketPath, 500);
        try {
          const res = await conn.request<{protocol?: number}>(
            'hello',
            undefined,
            1000,
          );
          conn.close();
          if (res) return cfg;
        } catch (reqErr) {
          conn.close();
          lastError = reqErr;
        }
      }
    } catch (err) {
      lastError = err;
    }
    const timeLeft = deadline - Date.now();
    if (timeLeft > 0) {
      await new Promise(r => setTimeout(r, Math.min(100, timeLeft)));
    }
  }
  throw new Error(
    `Timeout: daemon [${session}] not ready within ${timeoutMs}ms`,
    lastError === undefined ? undefined : {cause: lastError},
  );
}

/**
 * 核验后台运行中 daemon 的版本与当前 CLI 版本是否一致。
 * 对齐 chrome-devtools-mcp 的 verifyDaemonVersion。
 * 若不一致返回警告提示，否则返回 undefined。
 */
export async function verifyDaemonVersion(
  session: string,
  cliVersion: string,
  daemonDir?: string,
): Promise<string | undefined> {
  const dir = daemonDir ?? computeClientInfo().daemonDir;
  const cfg = await loadSession(dir, session);
  if (!cfg || !isPidAlive(cfg.pid)) return undefined;
  try {
    const conn = await DaemonConnection.connect(cfg.socketPath, 1000);
    const status = await conn.request<DaemonStatusResult>(
      'status',
      undefined,
      1000,
    );
    conn.close();
    if (status?.version && status.version !== cliVersion) {
      return `Warning: Daemon server version (${status.version}) does not match CLI version (${cliVersion}). Run 'browsercli -s=${session} close' to update and restart the daemon.`;
    }
  } catch {
    // 忽略探活时的偶发通讯错误，由命令自身处理错误
  }
  return undefined;
}
