/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {getConvertedSkillToolDefinitions} from '../converted-skill-tools.js';
import {tableOutput, successOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

interface SkillInfo {
  name: string;
  description: string;
  category?: string;
  toolName?: string;
}

export const listSkillsCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  const skills: SkillInfo[] = [];
  let source = 'built-in';

  try {
    const invoker = ctx?.invoker;
    const group = ctx?.group;
    if (invoker && group) {
      const result = (await invoker.invoke(group, '_list_skills')) as {
        skills?: SkillInfo[];
      };
      if (result.skills && result.skills.length > 0) {
        skills.push(...result.skills);
        source = 'worker';
      }
    }
  } catch {
    // Worker not running, use converted built-in tool definitions
  }

  if (skills.length === 0) {
    skills.push(...getConvertedSkillToolDefinitions());
  }

  if (json) {
    return successOutput({command: 'list-skills', skills, source});
  }

  const headers = ['Legacy Skill', 'Tool', 'Category', 'Description'];
  const rows = skills.map(s => [
    s.name,
    s.toolName || '',
    s.category || '',
    s.description,
  ]);

  const output: Record<string, unknown> = {
    command: 'list-skills',
    total: skills.length,
    source,
  };

  if (source === 'built-in') {
    output.note = 'Skill 模块已迁移为 Tool；Worker 未运行，显示内置兼容映射';
  }

  return {
    ...output,
    ...tableOutput(headers, rows),
  };
};
