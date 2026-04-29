/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {parseArgs} from '../args-parser.js';
import {successOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

import {
  parseSkillInvocationArgs,
  resolveLegacySkillToolName,
} from './shared/skill-args.js';
import {requireWorkerRuntime} from './shared/worker-runtime.js';

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

  const skillArgs = parseSkillInvocationArgs(parsed);

  try {
    const {group, invoker} = requireWorkerRuntime(ctx);
    const toolName = resolveLegacySkillToolName(skillName);
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
        tool: toolName,
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
