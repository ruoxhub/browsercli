/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {tableOutput, successOutput} from '../output.js';
import {getBoolFlag, parseArgs} from '../args-parser.js';
import {SekiroInvoker} from '../sekiro-invoker.js';
import {getBuiltInSkillDefinitions} from '../../skills/index.js';
import {resolveConfig} from '../config.js';

interface SkillInfo {
  name: string;
  description: string;
  category?: string;
}

export const listSkillsCommand: AxiCliCommand<DaemonContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  const skills: SkillInfo[] = [];
  let source = 'built-in';

  try {
    const cfg = ctx?.resolvedConfig ?? resolveConfig();
    const invoker = ctx?.invoker ?? new SekiroInvoker({sekiroHost: cfg.sekiroHost});
    const result = await invoker.invoke(cfg.group, '_list_skills') as {
      skills?: SkillInfo[];
    };
    if (result.skills && result.skills.length > 0) {
      skills.push(...result.skills);
      source = 'worker';
    }
  } catch {
    // Worker not running, use built-in definitions
  }

  if (skills.length === 0) {
    const builtIns = getBuiltInSkillDefinitions();
    skills.push(
      ...builtIns.map(skill => ({
        name: skill.name,
        description: skill.description,
        category: (skill as {category?: string}).category,
      })),
    );
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
    output.note = 'Worker 未运行，显示内置技能列表';
  }

  return {
    ...output,
    ...tableOutput(headers, rows),
  };
};
