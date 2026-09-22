/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 会话命令：open / close / list / kill-all。
 * status 与 list 共享注册表探测逻辑（collectSessionRows）。
 */

import fs from 'node:fs';
import path from 'node:path';

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {
  DaemonConnection,
  ensureDaemon,
  killAllDaemons,
  stopSession,
  type DaemonLike,
  type DaemonStatusResult,
} from '../daemonClient.js';
import {successOutput, tableOutput} from '../output.js';
import {
  computeClientInfo,
  deleteSession,
  listSessions,
  loadSession,
  type SessionConfig,
} from '../sessionPaths.js';
import type {WorkerContext} from '../types.js';

export interface SessionRow {
  session: string;
  pid: number;
  console: string;
  status: string;
  version?: string;
  uptimeMs?: number;
  startDate?: string;
  socketPath?: string;
}

export interface ProbeResult extends DaemonLike {
  statusResult?: DaemonStatusResult;
}

/** 对单个会话探活（connect + status/hello）：成功返回连接对象，附带 statusResult */
export async function probeSession(
  cfg: SessionConfig,
): Promise<ProbeResult | undefined> {
  try {
    const conn = await DaemonConnection.connect(cfg.socketPath, 500);
    let statusResult: DaemonStatusResult | undefined;
    try {
      statusResult = await conn.request<DaemonStatusResult>(
        'status',
        undefined,
        1000,
      );
    } catch {
      try {
        statusResult = await conn.request<DaemonStatusResult>(
          'hello',
          undefined,
          1000,
        );
      } catch {
        // 兼容旧接口
      }
    }
    const result = conn as ProbeResult;
    result.statusResult = statusResult;
    return result;
  } catch {
    return undefined;
  }
}

/**
 * 读注册表并逐会话探活：连不上的 GC stale session 文件并标记 stale。
 * daemonDir 缺省时按当前 workspace 注册表读取。
 */
export async function collectSessionRows(
  daemonDir?: string,
): Promise<SessionRow[]> {
  const dir = daemonDir ?? computeClientInfo().daemonDir;
  const sessions = await listSessions(dir);
  const rows: SessionRow[] = [];
  for (const cfg of sessions) {
    const conn = await probeSession(cfg);
    if (conn) {
      const st = conn.statusResult;
      conn.close();
      rows.push({
        session: cfg.name,
        pid: cfg.pid,
        console:
          cfg.consolePort === undefined ? '-' : `127.0.0.1:${cfg.consolePort}`,
        status: 'open',
        version: st?.version ?? cfg.version,
        uptimeMs: st?.uptimeMs,
        startDate: st?.startDate,
        socketPath: cfg.socketPath,
      });
    } else {
      await deleteSession(dir, cfg.name);
      rows.push({
        session: cfg.name,
        pid: cfg.pid,
        console: '-',
        status: 'closed-stale',
      });
    }
  }
  return rows;
}

export const openCommand: AxiCliCommand<WorkerContext> = async (_args, ctx) => {
  if (!ctx) throw new AxiError('内部错误：缺少会话上下文', 'INTERNAL');
  const info = computeClientInfo();
  const daemonDir = ctx.daemonDir ?? info.daemonDir;
  const existing = await loadSession(daemonDir, ctx.session);
  if (existing) {
    const conn = await probeSession(existing);
    if (conn) {
      conn.close();
      throw new AxiError(
        `会话 ${ctx.session} 已在运行 (pid=${existing.pid})`,
        'SESSION_ALREADY_OPEN',
        [`先关闭：browsercli -s=${ctx.session} close`],
      );
    }
    // 陈旧注册：ensureDaemon 会自行 GC 并重新拉起
  }
  const cfg = await ensureDaemon({
    session: ctx.session,
    spawnFlags: ctx.spawnFlags ?? [],
    daemonDir,
  });
  return successOutput({
    command: 'open',
    session: cfg.name,
    pid: cfg.pid,
    consolePort: cfg.consolePort ?? null,
    socketPath: cfg.socketPath,
  });
};

export const closeCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  if (!ctx) throw new AxiError('内部错误：缺少会话上下文', 'INTERNAL');
  const info = computeClientInfo();
  const daemonDir = ctx.daemonDir ?? info.daemonDir;
  const cfg = await loadSession(daemonDir, ctx.session);
  if (!cfg) {
    return successOutput({
      command: 'close',
      session: ctx.session,
      stopped: false,
      message: `会话 ${ctx.session} 未运行`,
    });
  }
  await stopSession(cfg, daemonDir);
  return successOutput({command: 'close', session: ctx.session, stopped: true});
};

export const listSessionsCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  const rows = await collectSessionRows(ctx?.daemonDir);
  return {
    ...tableOutput(
      ['Session', 'PID', 'Console', 'Status'],
      rows.map(r => [r.session, String(r.pid), r.console, r.status]),
    ),
    command: 'list',
    sessions: rows,
  };
};

export const killAllCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  const pids = await killAllDaemons();
  // 强杀后清掉当前 workspace 注册表里所有 session 文件及残余锁文件
  const daemonDir = ctx?.daemonDir ?? computeClientInfo().daemonDir;
  for (const cfg of await listSessions(daemonDir)) {
    await deleteSession(daemonDir, cfg.name);
  }
  try {
    const files = await fs.promises.readdir(daemonDir);
    for (const f of files) {
      if (f.endsWith('.spawn.lock')) {
        await fs.promises
          .unlink(path.join(daemonDir, f))
          .catch(() => undefined);
      }
    }
  } catch {
    // 忽略目录不存在等异常
  }
  return successOutput(
    {
      command: 'kill-all',
      killed: pids,
    },
    ctx?.session,
  );
};

export const sessionCommands: Record<string, AxiCliCommand<WorkerContext>> = {
  open: openCommand,
  close: closeCommand,
  list: listSessionsCommand,
  'kill-all': killAllCommand,
};
