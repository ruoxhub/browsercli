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

interface ListedTool {
  name: string;
  description?: string;
}

export const listToolsCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const json = getBoolFlag(parsed, 'json');

  let tools: ListedTool[] = [];
  let isOffline = false;
  const legacySkills = getConvertedSkillToolDefinitions();

  try {
    const invoker = ctx?.invoker;
    const group = ctx?.group;
    if (invoker && group) {
      const result = (await invoker.invoke(group, '_list_tools')) as {
        tools?: Array<{name: string; description?: string}>;
      };
      tools = result.tools || [];
    }
  } catch {
    isOffline = true;
  }

  if (tools.length === 0) {
    isOffline = true;
    const {getAllToolNames, getToolMeta} = await import('../tools-meta.js');
    tools = getAllToolNames().map(name => {
      const meta = getToolMeta(name);
      return {name, description: meta?.description};
    });
  }

  if (json) {
    return successOutput({
      command: 'list-tools',
      tools,
      legacySkills,
      offline: isOffline,
    });
  }

  const headers = ['Type', 'Name', 'Tool', 'Category', 'Description'];
  const toolRows = tools.map(t => [
    'tool',
    t.name,
    t.name,
    '',
    t.description || '',
  ]);
  const skillRows = legacySkills.map(skill => [
    'legacy-skill',
    skill.name,
    skill.toolName,
    skill.category,
    skill.description,
  ]);

  const output: Record<string, unknown> = {
    command: 'list-tools',
    total: tools.length,
    legacySkillTotal: legacySkills.length,
  };

  if (isOffline) {
    output.note = '离线模式：显示内置工具定义';
  }

  return {
    ...output,
    ...tableOutput(headers, [...toolRows, ...skillRows]),
  };
};
