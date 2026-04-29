/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {AxiError} from 'axi-sdk-js';

import {getFlag, type ParsedArgs} from '../../args-parser.js';
import {getConvertedSkillToolName} from '../../converted-skill-tools.js';

export function parseSkillInvocationArgs(
  parsed: ParsedArgs,
): Record<string, unknown> {
  const url = getFlag(parsed, 'url');
  const dataStr = getFlag(parsed, 'data');
  const skillArgs: Record<string, unknown> = {};

  if (url) {
    skillArgs.url = url;
  }

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

  return skillArgs;
}

export function resolveLegacySkillToolName(skillName: string): string {
  return getConvertedSkillToolName(skillName) ?? skillName.replaceAll('-', '_');
}
