/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {AxiError} from '../errors.js';
import {successOutput} from '../output.js';
import {parseArgs} from '../args-parser.js';
import {getToolMeta, getAllToolNames, searchTools} from '../tools-meta.js';
import {SekiroInvoker} from '../sekiro-invoker.js';
import {resolveConfig} from '../config.js';

export const toolDispatcherCommand: AxiCliCommand<DaemonContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const toolName = parsed.positionals[0];

  if (!toolName) {
    throw new AxiError('缺少工具名称', 'VALIDATION_ERROR', [
      `用法：js-reverse call <tool-name> [--param value]`,
    ]);
  }

  const meta = getToolMeta(toolName);
  if (!meta) {
    const suggestions = searchTools(toolName)
      .map(t => t.name)
      .slice(0, 5);
    throw new AxiError(`未知工具：${toolName}`, 'UNKNOWN_TOOL', suggestions);
  }

  const toolArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.flags)) {
    if (typeof value === 'boolean') {
      toolArgs[key] = value;
      continue;
    }
    const schemaType = meta.schema[key];
    if (schemaType === 'number') toolArgs[key] = Number(value);
    else if (schemaType === 'boolean') toolArgs[key] = value === 'true';
    else if (typeof value === 'string' && value.includes(','))
      toolArgs[key] = value.split(',').map(s => s.trim());
    else toolArgs[key] = value;
  }

  try {
    const cfg = ctx?.resolvedConfig ?? resolveConfig();
    const invoker = ctx?.invoker ?? new SekiroInvoker({sekiroHost: cfg.sekiroHost});
    const result = await invoker.invoke(cfg.group, toolName, toolArgs);

    return successOutput({
      command: 'call',
      tool: toolName,
      result,
    });
  } catch (error) {
    throw new AxiError(
      `工具调用失败：${error instanceof Error ? error.message : error}`,
      'TOOL_INVOCATION_ERROR',
    );
  }
};
