/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {WorkerContext} from '../types.js';
import {AxiError} from 'axi-sdk-js';
import {successOutput} from '../output.js';
import {parseArgs, getFlag} from '../args-parser.js';

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
      skillArgs.data = JSON.parse(dataStr);
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
    const actionName = `skill_${skillName}`;
    const result = await invoker.invoke(group, actionName, skillArgs) as {
      success?: boolean;
      error?: string;
      message?: string;
      data?: unknown;
    };

    if (result.success) {
      return successOutput({
        command: 'call-skill',
        skill: skillName,
        result: result.data ?? result.message ?? '技能执行成功',
      });
    }
    throw new AxiError(
      `技能执行失败：${result.error || result.message || '未知错误'}`,
      'SKILL_ERROR',
    );
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `技能调用失败：${error instanceof Error ? error.message : error}`,
      'SEKIRO_ERROR',
      ['确保 Worker 正在运行：js-reverse start --browserUrl <url>'],
    );
  }
};
