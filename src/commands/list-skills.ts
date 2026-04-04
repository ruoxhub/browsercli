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
      console.log('可用技能:');
      for (const skill of skills) {
        console.log(`  - ${skill.name}: ${skill.description}`);
      }
    }
  } catch (error) {
    console.error(
      `获取技能列表失败：${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
