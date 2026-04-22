/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {tableOutput, successOutput} from '../output.js';
import {getBoolFlag, parseArgs} from '../args-parser.js';
import {SekiroInvoker} from '../sekiro-invoker.js';
import {resolveConfig} from '../config.js';

export const listToolsCommand: AxiCliCommand<DaemonContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  let tools: Array<{name: string; description?: string}> = [];
  let isOffline = false;

  try {
    const cfg = ctx?.resolvedConfig ?? resolveConfig();
    const invoker = ctx?.invoker ?? new SekiroInvoker({sekiroHost: cfg.sekiroHost});
    const result = await invoker.invoke(cfg.group, '_list_tools') as {
      tools?: Array<{name: string; description?: string}>;
    };
    tools = result.tools || [];
  } catch {
    isOffline = true;
  }

  if (tools.length === 0) {
    isOffline = true;
    const {getAllToolNames, getToolMeta} = await import('../tools-meta.js');
    tools = getAllToolNames().map(name => {
      const meta = getToolMeta(name);
      return {name, description: meta?.description};
    });
  }

  if (json) {
    return successOutput({command: 'list-tools', tools, offline: isOffline});
  }

  const headers = ['Name'];
  const rows = tools.map(t => [t.name]);

  const output: Record<string, unknown> = {
    command: 'list-tools',
    total: tools.length,
  };

  if (isOffline) {
    output.note = '离线模式：显示内置工具定义';
  }

  return {
    ...output,
    ...tableOutput(headers, rows),
  };
};
