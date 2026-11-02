/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {killAllDaemons, stopSession} from '../daemonClient.js';
import {successOutput} from '../output.js';
import {
  computeClientInfo,
  deleteSession,
  listSessions,
  loadSession,
} from '../sessionPaths.js';
import type {WorkerContext} from '../types.js';

export const stopCommand: AxiCliCommand<WorkerContext> = async (args, ctx) => {
  const parsed = parseArgs(args);
  const stopAll = getBoolFlag(parsed, 'all');

  const info = computeClientInfo();
  const daemonDir = ctx?.daemonDir ?? info.daemonDir;

  if (stopAll) {
    const pids = await killAllDaemons();
    // 强杀后清掉当前 workspace 注册表里所有 session 文件及残余锁文件
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
        command: 'stop',
        action: 'stop-all',
        stopped: true,
        killed: pids,
      },
      ctx?.session,
    );
  }

  const sessionName = ctx?.session ?? 'default';
  const cfg = await loadSession(daemonDir, sessionName);
  if (!cfg) {
    return successOutput(
      {
        command: 'stop',
        session: sessionName,
        stopped: false,
        message: `会话 ${sessionName} 未运行`,
      },
      sessionName,
    );
  }

  await stopSession(cfg, daemonDir);
  return successOutput(
    {
      command: 'stop',
      session: sessionName,
      stopped: true,
    },
    sessionName,
  );
};
