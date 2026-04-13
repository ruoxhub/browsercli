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
import {sendCommand} from '../../daemon/client.js';
import {getToolMeta, getAllToolNames, searchTools} from '../tools-meta.js';

export const toolDispatcherCommand: AxiCliCommand<DaemonContext> = async (
  args,
  _ctx,
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
    } else {
      const schemaType = meta.schema[key];
      if (schemaType === 'number') {
        toolArgs[key] = Number(value);
      } else if (schemaType === 'boolean') {
        toolArgs[key] = value === 'true';
      } else if (typeof value === 'string' && value.includes(',')) {
        toolArgs[key] = value.split(',').map(s => s.trim());
      } else {
        toolArgs[key] = value;
      }
    }
  }

  try {
    const result = await sendCommand({
      method: 'invoke_tool',
      tool: toolName,
      args: toolArgs,
    });

    if (result.success) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.result as string);
      } catch {
        parsed = result.result || '执行成功';
      }
      return successOutput({
        command: 'call',
        tool: toolName,
        result: parsed,
      });
    }
    throw new AxiError(`工具执行失败：${result.error}`, 'TOOL_EXECUTION_ERROR');
  } catch (error) {
    throw new AxiError(
      `工具调用失败：${error instanceof Error ? error.message : error}`,
      'TOOL_INVOCATION_ERROR',
    );
  }
};
