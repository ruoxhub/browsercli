/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {AxiError} from '../errors.js';
import {successOutput} from '../output.js';
import {parseArgs, getFlag} from '../args-parser.js';
import {sendCommand} from '../../daemon/client.js';

export const callSkillCommand: AxiCliCommand<DaemonContext> = async (
  args,
  _ctx,
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
  if (url) {
    skillArgs.url = url;
  }
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
    const result = await sendCommand({
      method: 'invoke_skill',
      skill: skillName,
      args: skillArgs,
    });

    if (result.success) {
      return successOutput({
        command: 'call-skill',
        skill: skillName,
        result: result.result || '技能执行成功',
      });
    }
    throw new AxiError(`技能执行失败：${result.error}`, 'SKILL_ERROR');
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `技能调用失败：${error instanceof Error ? error.message : error}`,
      'DAEMON_ERROR',
      ['确保后台服务正在运行：js-reverse start --browserUrl <url>'],
    );
  }
};
