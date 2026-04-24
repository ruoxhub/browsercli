/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {parseArgs, getFlag} from '../args-parser.js';
import {getConvertedSkillToolName} from '../converted-skill-tools.js';
import {successOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

export const callSkillCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const skillName = parsed.positionals[0];

  if (!skillName) {
    throw new AxiError('缺少技能名称参数', 'VALIDATION_ERROR', [
      '用法：js-reverse call-skill <skill-name> [--url <url>] [--data <json>]',
    ]);
  }

  const url = getFlag(parsed, 'url');
  const dataStr = getFlag(parsed, 'data');

  const skillArgs: Record<string, unknown> = {};
  if (url) skillArgs.url = url;
  if (dataStr) {
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

  try {
    const invoker = ctx?.invoker;
    const group = ctx?.group;
    if (!invoker || !group) {
      throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');
    }
    const toolName =
      getConvertedSkillToolName(skillName) ?? skillName.replaceAll('-', '_');
    const result = (await invoker.invoke(group, toolName, skillArgs)) as {
      success?: boolean;
      error?: string;
      message?: string;
      data?: unknown;
    };

    if (result.success) {
      return successOutput({
        command: 'call-skill',
        skill: skillName,
        tool:
          getConvertedSkillToolName(skillName) ??
          skillName.replaceAll('-', '_'),
        result: result.data ?? result.message ?? '工具执行成功',
      });
    }
    throw new AxiError(
      `工具执行失败：${result.error || result.message || '未知错误'}`,
      'SKILL_ERROR',
    );
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `兼容技能调用失败：${error instanceof Error ? error.message : error}`,
      'SEKIRO_ERROR',
      ['确保 Worker 正在运行：js-reverse start --browserUrl <url>'],
    );
  }
};
