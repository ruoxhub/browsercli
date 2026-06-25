/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {tableOutput, successOutput} from '../output.js';
import {
  ensureToolsMeta,
  getAllToolsMeta,
  getToolMeta,
} from '../tools-meta.js';
import type {WorkerContext} from '../types.js';
import type {ToolArgSpecMap} from '../zod-introspect.js';

interface ListedTool {
  name: string;
  description?: string;
}

function typeLabelFor(type: string): string {
  switch (type) {
    case 'string': return '<str>';
    case 'number': return '<num>';
    case 'boolean': return '<bool>';
    default: return '<arr>';
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

  let tools: ListedTool[] = [];
  let isOffline = false;

  try {
    const invoker = ctx?.invoker;
    const group = ctx?.group;
    if (invoker && group) {
      const result = (await invoker.invoke(group, '_list_tools')) as {
        tools?: Array<{name: string; description?: string}>;
      };
      tools = result.tools || [];
    }
  } catch {
    isOffline = true;
  }

  if (tools.length === 0) {
    isOffline = true;
  }

  // 始终加载本地工具元信息，以便获取参数签名
  await ensureToolsMeta();

  if (isOffline) {
    const allMeta = getAllToolsMeta();
    tools = allMeta.map(m => ({
      name: m.name,
      description: m.description,
    }));
  }

  if (json) {
    const enrichedTools = tools.map(t => {
      const meta = getToolMeta(t.name);
      return {
        ...t,
        signature: formatArgSignature(meta?.argSpecs),
      };
    });
    return successOutput({
      command: 'list-tools',
      tools: enrichedTools,
      offline: isOffline,
    });
  }

  const headers = ['Name', 'Signature', 'Description'];
  const toolRows = tools.map(t => {
    const meta = getToolMeta(t.name);
    return [
      t.name,
      formatArgSignature(meta?.argSpecs) || '-',
      t.description || '',
    ];
  });

  const total = toolRows.length;

  const output: Record<string, unknown> = {
    command: 'list-tools',
    total,
  };

  if (isOffline) {
    output.note = '离线模式：显示内置工具定义';
  }

  return {
    ...output,
    ...tableOutput(headers, toolRows),
  };
};
