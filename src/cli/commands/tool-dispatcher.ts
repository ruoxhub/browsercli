/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {parseArgs} from '../args-parser.js';
import {
  getConvertedSkillToolDefinitions,
  getConvertedSkillToolName,
} from '../converted-skill-tools.js';
import {successOutput} from '../output.js';
import {validateToolArgs} from '../tool-arg-validator.js';
import {getToolMeta, searchTools} from '../tools-meta.js';
import type {WorkerContext} from '../types.js';

function parseSkillArgs(
  parsed: ReturnType<typeof parseArgs>,
): Record<string, unknown> {
  const url = parsed.flags.url;
  const dataStr = parsed.flags.data;
  const skillArgs: Record<string, unknown> = {};

  if (typeof url === 'string') {
    skillArgs.url = url;
  }

  if (typeof dataStr === 'string') {
    try {
      const parsedData = JSON.parse(dataStr) as unknown;
      if (
        parsedData &&
        typeof parsedData === 'object' &&
        !Array.isArray(parsedData)
      ) {
        Object.assign(skillArgs, parsedData);
      } else {
        skillArgs.data = parsedData;
      }
    } catch {
      throw new AxiError(
        `--data 参数必须是有效的 JSON 格式，收到：${dataStr}`,
        'VALIDATION_ERROR',
      );
    }
  }

  return skillArgs;
}

export const toolDispatcherCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const requestedName = parsed.positionals[0];

  if (!requestedName) {
    throw new AxiError('缺少工具或兼容技能名称', 'VALIDATION_ERROR', [
      `用法：js-reverse call <tool-or-skill-name> [--param value] [--url <url>] [--data <json>]`,
    ]);
  }

  const meta = getToolMeta(requestedName);
  const convertedToolName = getConvertedSkillToolName(requestedName);
  const isLegacySkill = Boolean(convertedToolName && !meta);

  if (!meta && !convertedToolName) {
    const suggestions = [
      ...searchTools(requestedName).map(t => t.name),
      ...getConvertedSkillToolDefinitions()
        .filter(
          skill =>
            skill.name.includes(requestedName) ||
            skill.toolName.includes(requestedName),
        )
        .map(skill => skill.name),
    ]
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, 5);
    throw new AxiError(
      `未知工具或兼容技能：${requestedName}`,
      'UNKNOWN_TOOL',
      suggestions,
    );
  }

  const toolName = meta?.name ?? convertedToolName!;
  const toolArgs: Record<string, unknown> = isLegacySkill
    ? parseSkillArgs(parsed)
    : {};

  if (meta) {
    for (const [key, value] of Object.entries(parsed.flags)) {
      if (typeof value === 'boolean') {
        toolArgs[key] = value;
        continue;
      }
      const schemaType = meta.schema[key];
      if (schemaType === 'number') {
        toolArgs[key] = Number(value);
      } else if (schemaType === 'boolean') {
        toolArgs[key] = value === 'true' || value === '1';
      } else if (schemaType === 'string') {
        toolArgs[key] = value;
      } else if (typeof value === 'string' && value.includes(',')) {
        toolArgs[key] = value.split(',').map(s => s.trim());
      } else {
        // 无 schema 时，尝试智能推断：纯数字字符串转 number，"true"/"false" 转 boolean
        if (value === 'true' || value === 'false') {
          toolArgs[key] = value === 'true';
        } else if (/^-?\d+(\.\d+)?$/.test(value)) {
          toolArgs[key] = Number(value);
        } else {
          toolArgs[key] = value;
        }
      }
    }
  }

  try {
    const invoker = ctx?.invoker;
    const group = ctx?.group;
    if (!invoker || !group) {
      throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
    }
    const validatedArgs = validateToolArgs(toolName, toolArgs);
    if (validatedArgs.ok === false) {
      throw new AxiError(validatedArgs.error, 'VALIDATION_ERROR');
    }

    const result = await invoker.invoke(group, toolName, validatedArgs.value);

    return successOutput({
      command: 'call',
      target: requestedName,
      tool: toolName,
      ...(isLegacySkill ? {legacySkill: requestedName} : {}),
      result,
    });
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `工具调用失败：${error instanceof Error ? error.message : error}`,
      'TOOL_INVOCATION_ERROR',
    );
  }
};
