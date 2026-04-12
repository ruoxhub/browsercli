/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
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
    return {
      status: 'error',
      command: 'call',
      message: '缺少工具名称',
      suggestion: `用法：js-reverse call <tool-name> [--param value]`,
      availableTools: getAllToolNames().slice(0, 20),
      totalTools: getAllToolNames().length,
    };
  }

  const meta = getToolMeta(toolName);
  if (!meta) {
    const suggestions = searchTools(toolName)
      .map(t => t.name)
      .slice(0, 5);
    return {
      status: 'error',
      command: 'call',
      tool: toolName,
      message: `未知工具：${toolName}`,
      suggestions,
    };
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
      return successOutput({
        command: 'call',
        tool: toolName,
        result: result.result || '执行成功',
      });
    }
    return {
      status: 'error',
      command: 'call',
      tool: toolName,
      message: `工具执行失败：${result.error}`,
    };
  } catch (error) {
    return {
      status: 'error',
      command: 'call',
      tool: toolName,
      message: `工具调用失败：${error instanceof Error ? error.message : error}`,
    };
  }
};
