/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {CLI_VERSION, DaemonConnection} from '../daemonClient.js';
import {successOutput, tableOutput} from '../output.js';
import type {BrowserConnectionStatus, WorkerContext} from '../types.js';

import {collectSessionRows} from './sessions.js';

export const statusCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  const rows = await collectSessionRows(ctx?.daemonDir);
  const currentSessionName = ctx?.session ?? 'default';
  const currentRow = rows.find(
    r => r.session === currentSessionName && r.status === 'open',
  );

  let browserStatus: BrowserConnectionStatus | undefined;
  if (currentRow?.socketPath) {
    try {
      const conn = await DaemonConnection.connect(currentRow.socketPath, 1000);
      try {
        browserStatus = await conn.request<BrowserConnectionStatus>(
          'browser.status',
          undefined,
          1000,
        );
      } finally {
        conn.close();
      }
    } catch {
      // 探查浏览器状态失败时静默跳过
    }
  }

  const openCount = rows.filter(r => r.status === 'open').length;

  const versionWarnings = rows
    .filter(r => r.status === 'open' && r.version && r.version !== CLI_VERSION)
    .map(
      r =>
        `Warning: Daemon server version (${r.version}) does not match CLI version (${CLI_VERSION}) for session '${r.session}'. Run 'browsercli -s=${r.session} stop' to update and restart the daemon.`,
    );

  const isCurrentOnline = Boolean(currentRow);

  if (json) {
    return successOutput(
      {
        command: 'status',
        online: isCurrentOnline,
        session: currentSessionName,
        current: currentRow ?? null,
        browser: browserStatus ?? null,
        totalOnline: openCount,
        sessions: rows,
        ...(openCount === 0 ? {message: '没有运行中的 daemon 会话'} : {}),
        ...(versionWarnings.length > 0 ? {warnings: versionWarnings} : {}),
      },
      currentSessionName,
    );
  }

  // 终端多行格式化
  const sections: string[] = [];
  if (currentRow) {
    sections.push(
      `会话 '${currentSessionName}' 正在运行 (PID: ${currentRow.pid}, 控制台: ${currentRow.console})`,
    );
    if (browserStatus) {
      const bState = browserStatus.connected
        ? `已连接 (${browserStatus.mode}, ${browserStatus.pages} 个活动页面)`
        : '未连接';
      sections.push(`浏览器状态: ${bState}`);
    }
  } else {
    sections.push(
      `当前会话 '${currentSessionName}' 未运行。可运行 'browsercli start' 拉起服务。`,
    );
  }

  const table = tableOutput(
    ['Session', 'PID', 'Console', 'Status'],
    rows.map(r => [r.session, String(r.pid), r.console, r.status]),
  );

  return {
    ...table,
    command: 'status',
    session: currentSessionName,
    online: isCurrentOnline,
    current: currentRow ?? null,
    browser: browserStatus ?? null,
    sessions: rows,
    ...(versionWarnings.length > 0 ? {warnings: versionWarnings} : {}),
  };
};
