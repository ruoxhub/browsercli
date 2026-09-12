/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
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

  if (json) {
    return successOutput(
      {
        command: 'status',
        online: openCount > 0,
        sessions: rows,
        ...(openCount === 0 ? {message: '没有运行中的 daemon 会话'} : {}),
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
    session: ctx?.session,
    online: openCount > 0,
  };
};
