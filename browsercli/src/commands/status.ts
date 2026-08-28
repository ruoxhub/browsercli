/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {successOutput, tableOutput} from '../output.js';
import type {ToolMeta} from '../tool-meta-types.js';
import type {WorkerContext} from '../types.js';

export const statusCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  const httpClient = ctx?.httpClient;
  const workerUrl =
    httpClient?.baseUrl ?? process.env.WORKER_URL ?? 'http://127.0.0.1:8765';
  const transport = ctx?.transport ?? 'http';

  let online = false;
  let healthStatus = 'offline';
  let sessionsCount = 0;
  let toolsCount = 0;

  if (httpClient) {
    try {
      const healthRes = await httpClient.health();
      healthStatus = healthRes.status ?? 'ok';
      online = true;

      const [sessionsRes, toolsRes] = await Promise.all([
        httpClient.listSessions().catch(() => ({sessions: []})),
        httpClient.listTools().catch(() => ({tools: [] as ToolMeta[]})),
      ]);

      sessionsCount = Array.isArray(sessionsRes.sessions)
        ? sessionsRes.sessions.length
        : 0;
      toolsCount = Array.isArray(toolsRes.tools) ? toolsRes.tools.length : 0;
    } catch {
      online = false;
      healthStatus = 'offline';
    }
  }

  if (json) {
    return successOutput({
      command: 'status',
      online,
      workerUrl,
      status: healthStatus,
      sessionsCount,
      toolsCount,
      transport,
      ...(online ? {} : {message: 'Worker 服务未运行或无法连接'}),
    });
  }

  const headers = ['Property', 'Value'];
  const rows = [
    ['Worker URL', workerUrl],
    ['Status', online ? `Online (${healthStatus})` : 'Offline (Unreachable)'],
    ['Transport', transport],
    ['Active Sessions', online ? String(sessionsCount) : '-'],
    ['Available Tools', online ? String(toolsCount) : '-'],
  ];

  return {
    ...tableOutput(headers, rows),
    command: 'status',
    online,
  };
};
