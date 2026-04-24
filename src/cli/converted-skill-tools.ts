/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getToolMeta} from './tools-meta.js';

export interface ConvertedSkillToolDefinition {
  /** 旧技能名，保留给兼容命令展示 */
  name: string;
  /** 对应的新 Tool action 名 */
  toolName: string;
  description: string;
  category: 'observe' | 'hook' | 'rebuild';
}

const CONVERTED_SKILL_TOOLS: Array<{
  name: string;
  toolName: string;
  category: ConvertedSkillToolDefinition['category'];
}> = [
  {name: 'observe-flow', toolName: 'observe_flow', category: 'observe'},
  {name: 'auto-hook', toolName: 'auto_hook', category: 'hook'},
  {name: 'rebuild-bundle', toolName: 'rebuild_bundle', category: 'rebuild'},
];

export function getConvertedSkillToolDefinitions(): ConvertedSkillToolDefinition[] {
  return CONVERTED_SKILL_TOOLS.map(item => ({
    name: item.name,
    toolName: item.toolName,
    category: item.category,
    description: getToolMeta(item.toolName)?.description ?? '',
  }));
}

export function getConvertedSkillToolName(
  skillName: string,
): string | undefined {
  return CONVERTED_SKILL_TOOLS.find(item => item.name === skillName)?.toolName;
}
