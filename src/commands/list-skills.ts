#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getBuiltInSkillDefinitions} from '../skills/index.js';
import {sendCommand} from '../daemon/client.js';

interface SkillInfo {
  name: string;
  description: string;
  category?: string;
}

export function formatSkills(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return '可用技能:\n  (无可用技能)';
  }
  const lines = [`可用技能 (${skills.length}):`];
  for (const skill of skills) {
    const category = skill.category ? ` [${skill.category}]` : '';
    lines.push(`  - ${skill.name}:${category} ${skill.description}`);
  }
  return lines.join('\n');
}

export async function listSkillsCommand(options: {
  json?: boolean;
}): Promise<void> {
  const skills: SkillInfo[] = [];
  let source = 'built-in';

  // Try daemon first, fall back to built-in definitions
  try {
    const result = await sendCommand({method: 'list_skills'});
    if (result.success && result.result) {
      const data = JSON.parse(result.result);
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

  if (options.json) {
    console.log(JSON.stringify(skills, null, 2));
  } else {
    console.log(formatSkills(skills));
    if (source === 'built-in') {
      console.log('\n提示：后台服务未运行，显示内置技能列表。启动服务后显示完整列表。');
    }
  }
}
