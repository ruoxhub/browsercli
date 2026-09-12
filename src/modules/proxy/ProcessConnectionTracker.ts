/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

import {logger} from '../../utils/logger.js';

import type {ClientProcessMeta, ProcessInfo} from './types.js';

const execFileAsync = promisify(execFile);

export type RunCommand = (cmd: string, args: string[]) => Promise<string>;

export type {ProcessInfo};

const PORT_TTL_MS = 1500;
const PID_INFO_TTL_MS = 30_000;
const DEGRADED_THRESHOLD = 10;

/** 解析 netstat -ano 输出的 ESTABLISHED/TCP 行 → {localPort, pid}[]（容错本地化）。 */
export function parseNetstatOutput(
  out: string,
): Array<{localPort: number; pid: number}> {
  const rows: Array<{localPort: number; pid: number}> = [];
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0]?.toUpperCase() !== 'TCP') continue;
    const pidStr = parts[parts.length - 1];
    if (!/^\d+$/.test(pidStr)) continue;
    const local = parts[1];
    const portMatch = local.match(/:(\d+)$/);
    if (!portMatch) continue;
    rows.push({localPort: Number(portMatch[1]), pid: Number(pidStr)});
  }
  return rows;
}

/** 解析 tasklist /FO CSV /NH 输出行。 */
export function parseTasklistLine(
  line: string,
): {pid: number; name: string} | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('INFO:')) return null;
  const parts = trimmed.split('","').map(p => p.replace(/^"|"$/g, ''));
  if (parts.length >= 2) {
    const name = parts[0];
    const pid = Number(parts[1]);
    if (!Number.isNaN(pid) && name) {
      return {pid, name};
    }
  }
  return null;
}

export function parseTasklistOutput(
  out: string,
): Array<{pid: number; name: string}> {
  const list: Array<{pid: number; name: string}> = [];
  for (const line of out.split(/\r?\n/)) {
    const item = parseTasklistLine(line);
    if (item) list.push(item);
  }
  return list;
}

export class ProcessConnectionTracker {
  private readonly portEntries = new Map<number, {pid: number; at: number}>();
  private readonly pidInfo = new Map<number, {info: ProcessInfo; at: number}>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private lastRefreshAt = 0;
  private inFlightRefresh: Promise<void> | null = null;

  constructor(private readonly runCommand: RunCommand = defaultRunCommand) {}

  /** 拉全量连接表重建端口索引（spec §3.2 后台刷新模型），并发调用合并为单次执行。 */
  async refresh(): Promise<void> {
    if (this.inFlightRefresh) return this.inFlightRefresh;
    this.inFlightRefresh = this.doRefresh().finally(() => {
      this.inFlightRefresh = null;
    });
    return this.inFlightRefresh;
  }

  private async doRefresh(): Promise<void> {
    try {
      const out = await this.runCommand('netstat', ['-ano', '-p', 'tcp']);
      const now = Date.now();
      const rows = parseNetstatOutput(out);
      this.portEntries.clear();
      const newPids = new Set<number>();
      for (const {localPort, pid} of rows) {
        this.portEntries.set(localPort, {pid, at: now});
        const cached = this.pidInfo.get(pid);
        if (!cached || now - cached.at > PID_INFO_TTL_MS) {
          newPids.add(pid);
        }
      }

      if (newPids.size > 0) {
        try {
          // 单次全量拉取系统进程快照，避免针对几十个 PID 并发执行几十个 tasklist 子进程导致超时与句柄耗尽
          const tasklistOut = await this.runCommand('tasklist', [
            '/FO',
            'CSV',
            '/NH',
          ]);
          const entries = parseTasklistOutput(tasklistOut);
          if (entries.length > 0) {
            const map = new Map(entries.map(e => [e.pid, e.name]));
            for (const pid of newPids) {
              const name = map.get(pid);
              this.pidInfo.set(pid, {
                info: {pid, name: name ?? `pid-${pid}`},
                at: now,
              });
            }
          } else {
            await this.resolvePidsWithFilter(newPids, now);
          }
        } catch {
          await this.resolvePidsWithFilter(newPids, now);
        }
      }

      this.lastRefreshAt = now;
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      logger.debug('[ProcessTracker] refresh 失败，保留上次快照:', err);
    }
  }

  private async resolvePidsWithFilter(
    newPids: Set<number>,
    now: number,
  ): Promise<void> {
    await Promise.allSettled(
      Array.from(newPids).map(async pid => {
        try {
          const tasklistOut = await this.runCommand('tasklist', [
            '/FI',
            `PID eq ${pid}`,
            '/FO',
            'CSV',
            '/NH',
          ]);
          const entries = parseTasklistOutput(tasklistOut);
          const match = entries.find(e => e.pid === pid);
          this.pidInfo.set(pid, {
            info: {pid, name: match ? match.name : `pid-${pid}`},
            at: now,
          });
        } catch {
          this.pidInfo.set(pid, {
            info: {pid, name: `pid-${pid}`},
            at: now,
          });
        }
        return pid;
      }),
    );
  }

  /** 纯内存查询；过期（>1500ms）或未命中返回 null。绝不 fork 子进程。 */
  getProcessByPortSync(port: number): ClientProcessMeta | null {
    const entry = this.portEntries.get(port);
    if (!entry) return null;
    if (Date.now() - entry.at > PORT_TTL_MS) return null;
    const cached = this.pidInfo.get(entry.pid);
    if (cached && Date.now() - cached.at <= PID_INFO_TTL_MS) {
      return {pid: entry.pid, name: cached.info.name, path: cached.info.path};
    }
    return {pid: entry.pid, name: `pid-${entry.pid}`};
  }

  /**
   * 异步按端口查询进程（对标 mitmproxy windows.py: 遇到未命中端口主动 refresh 溯源）。
   * 优先查内存；未命中时主动触发 refresh()，并保留短暂重试以兼容内核 TCP 表落表延迟。
   */
  async getProcessByPort(port: number): Promise<ClientProcessMeta | null> {
    const cached = this.getProcessByPortSync(port);
    if (cached) return cached;

    await this.refresh();
    const afterRefresh = this.getProcessByPortSync(port);
    if (afterRefresh) return afterRefresh;

    await new Promise(resolve => setTimeout(resolve, 30));
    await this.refresh();
    return this.getProcessByPortSync(port);
  }

  async listActiveNetworkProcesses(selfPid?: number): Promise<ProcessInfo[]> {
    await this.refresh();
    const seen = new Map<number, ProcessInfo>();
    for (const {pid} of this.portEntries.values()) {
      if (pid === selfPid || pid === process.pid) continue;
      if (!seen.has(pid)) {
        const cached = this.pidInfo.get(pid);
        if (cached) {
          seen.set(pid, cached.info);
        } else {
          seen.set(pid, {pid, name: `pid-${pid}`});
        }
      }
    }
    return [...seen.values()];
  }

  startBackgroundRefresh(intervalMs = 500): void {
    this.stopBackgroundRefresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref?.();
  }

  stopBackgroundRefresh(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isDegraded(): boolean {
    return this.consecutiveFailures >= DEGRADED_THRESHOLD;
  }

  getLastRefreshAt(): number {
    return this.lastRefreshAt;
  }
}

async function defaultRunCommand(cmd: string, args: string[]): Promise<string> {
  const {stdout} = await execFileAsync(cmd, args, {
    timeout: 5000,
    windowsHide: true,
  });
  return stdout;
}
