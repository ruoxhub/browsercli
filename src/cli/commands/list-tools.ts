/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {successOutput, tableOutput} from '../output.js';
import type {ToolArgSpecMap, ToolMeta} from '../tool-meta-types.js';
import type {WorkerContext} from '../types.js';

function typeLabelFor(type: string): string {
  switch (type) {
    case 'string':
      return '<str>';
    case 'number':
      return '<num>';
    case 'boolean':
      return '<bool>';
    default:
      return '<arr>';
  }
}

function formatArgSignature(argSpecs?: ToolArgSpecMap): string {
  if (!argSpecs || Object.keys(argSpecs).length === 0) return '';
  const parts: string[] = [];
  for (const [key, spec] of Object.entries(argSpecs)) {
    const param = `--${key} ${typeLabelFor(spec.type)}`;
    parts.push(spec.required ? param : `[${param}]`);
  }
  return parts.join(' ');
}

export const listToolsCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  if (!ctx) {
    throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
  }

  let tools: ToolMeta[];
  const client = await ctx.connect();
  try {
    const listed = await client.request<{tools?: unknown[]}>('tools.list');
    // 归一化：防御旧版本/代理直接返回数组或省略 tools 字段
    tools = (
      Array.isArray(listed) ? listed : (listed?.tools ?? [])
    ) as ToolMeta[];
  } catch (error) {
    throw new AxiError(
      `Worker 未运行：${error instanceof Error ? error.message : error}`,
      'WORKER_NOT_RUNNING',
    );
  } finally {
    client.close();
  }

  if (json) {
    return successOutput(
      {
        command: 'list-tools',
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          signature: formatArgSignature(t.argSpecs),
        })),
        offline: false,
      },
      ctx.session,
    );
  }

  const headers = ['Name', 'Signature', 'Description'];
  const toolRows = tools.map(t => [
    t.name,
    formatArgSignature(t.argSpecs) || '-',
    t.description || '',
  ]);

  return {
    ...tableOutput(headers, toolRows),
    command: 'list-tools',
    session: ctx.session,
    total: toolRows.length,
  };
};
