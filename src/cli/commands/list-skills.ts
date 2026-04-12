/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {tableOutput, successOutput} from '../output.js';
import {getBoolFlag, parseArgs} from '../args-parser.js';
import {sendCommand} from '../../daemon/client.js';
import {getBuiltInSkillDefinitions} from '../../skills/index.js';

interface SkillInfo {
  name: string;
  description: string;
  category?: string;
}

export const listSkillsCommand: AxiCliCommand<DaemonContext> = async (
  args,
  _ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  const skills: SkillInfo[] = [];
  let source = 'built-in';

  try {
    const result = await sendCommand({method: 'list_skills'});
    if (result.success && result.result) {
      const data = JSON.parse(result.result as string);
      skills.push(...(data.skills || []));
      source = 'daemon';
    }
  } catch {
    // Daemon not running, use built-in definitions
  }

  if (skills.length === 0) {
    const builtIns = getBuiltInSkillDefinitions();
    for (const skill of builtIns) {
      skills.push({
        name: skill.name,
        description: skill.description,
        category: (skill as {category?: string}).category,
      });
    }
  }

  if (json) {
    return successOutput({command: 'list-skills', skills, source});
  }

  const headers = ['Name', 'Category', 'Description'];
  const rows = skills.map(s => [s.name, s.category || '', s.description]);

  const output: Record<string, unknown> = {
    command: 'list-skills',
    total: skills.length,
    source,
  };

  if (source === 'built-in') {
    output.note = '后台服务未运行，显示内置技能列表';
  }

  return {
    ...output,
    ...tableOutput(headers, rows),
  };
};
