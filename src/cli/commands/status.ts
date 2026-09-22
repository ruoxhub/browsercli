/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {CLI_VERSION} from '../daemonClient.js';
import {successOutput, tableOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

import {collectSessionRows} from './sessions.js';

export const statusCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  const rows = await collectSessionRows(ctx?.daemonDir);
  const openCount = rows.filter(r => r.status === 'open').length;

  const versionWarnings = rows
    .filter(r => r.status === 'open' && r.version && r.version !== CLI_VERSION)
    .map(
      r =>
        `Warning: Daemon server version (${r.version}) does not match CLI version (${CLI_VERSION}) for session '${r.session}'. Run 'browsercli -s=${r.session} close' to update and restart the daemon.`,
    );

  if (json) {
    return successOutput(
      {
        command: 'status',
        online: openCount > 0,
        sessions: rows,
        ...(openCount === 0 ? {message: '没有运行中的 daemon 会话'} : {}),
        ...(versionWarnings.length > 0 ? {warnings: versionWarnings} : {}),
      },
      ctx?.session,
    );
  }

  return {
    ...tableOutput(
      ['Session', 'PID', 'Console', 'Status'],
      rows.map(r => [r.session, String(r.pid), r.console, r.status]),
    ),
    command: 'status',
    ...(ctx?.session !== undefined ? {session: ctx.session} : {}),
    online: openCount > 0,
    ...(versionWarnings.length > 0 ? {warnings: versionWarnings} : {}),
  };
};
