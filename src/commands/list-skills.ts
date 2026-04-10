#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {sendCommand} from '../daemon/client.js';

interface SkillInfo {
  name: string;
  description: string;
  category?: string;
}

export function formatSkills(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return '可用技能:\n  (无可用技能)\n提示：使用 "js-reverse start" 启动服务后加载技能';
  }
  const lines = ['可用技能:'];
  for (const skill of skills) {
    const category = skill.category ? ` [${skill.category}]` : '';
    lines.push(`  - ${skill.name}:${category} ${skill.description}`);
  }
  return lines.join('\n');
}

export async function listSkillsCommand(options: {
  json?: boolean;
}): Promise<void> {
  try {
    const result = await sendCommand({method: 'list_skills'});
    if (!result.success || !result.result) {
      console.error('获取技能列表失败');
      process.exit(1);
    }

    const data = JSON.parse(result.result);
    const skills: SkillInfo[] = data.skills || [];

    if (options.json) {
      console.log(JSON.stringify(skills, null, 2));
    } else {
      console.log(formatSkills(skills));
    }
  } catch (error) {
    console.error(
      `获取技能列表失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
