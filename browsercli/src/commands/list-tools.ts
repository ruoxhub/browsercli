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

  const httpClient = ctx?.httpClient;
  if (!httpClient) {
    throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
  }

  let tools: ToolMeta[];
  try {
    const listed = await httpClient.listTools();
    tools = listed.tools as ToolMeta[];
  } catch (error) {
    throw new AxiError(
      `Worker 未运行：${error instanceof Error ? error.message : error}`,
      'WORKER_NOT_RUNNING',
    );
  }

  if (json) {
    return successOutput({
      command: 'list-tools',
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        signature: formatArgSignature(t.argSpecs),
      })),
      offline: false,
    });
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
    total: toolRows.length,
  };
};
