/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {SkillRegistry, SkillRunner} from '../skills/index.js';
import {zod} from '../third_party/index.js';
import {logger} from '../utils/logger.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

/**
 * MCP 技能调用工具 - 允许客户端通过 MCP 协议调用已注册的技能
 */
export const invokeSkill = defineTool({
  name: 'invoke-skill',
  description:
    '调用已注册的逆向工程技能（observe-flow, auto-hook, rebuild-bundle）',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
    title: 'Invoke skill',
  },
  schema: {
    skillName: zod
      .string()
      .describe('技能名称：observe-flow | auto-hook | rebuild-bundle'),
    options: zod
      .record(zod.string(), zod.unknown())
      .optional()
      .describe('技能配置选项'),
    url: zod.string().optional().describe('目标 URL（可选）'),
  },
  handler: async (request, response, _context, _runtime) => {
    const {skillName, options = {}, url} = request.params;

    logger.debug(`[invoke-skill] Received request: skill=${skillName}`);

    try {
      const registry = SkillRegistry.getInstance();
      const skill = registry.get(skillName);

      if (!skill) {
        const availableSkills = registry.list();
        response.setStructuredContent({
          success: false,
          error: `技能不存在：${skillName}`,
          availableSkills: availableSkills.map(s => ({
            name: s.name,
            description: s.description,
            category: s.category,
          })),
        });
        return;
      }

      logger.info(`[invoke-skill] Executing skill: ${skillName}`);

      const runner = new SkillRunner();
      const result = await runner.run(skillName, {
        url,
        options,
      });

      logger.info(
        `[invoke-skill] Skill completed: ${skillName}, success=${result.success}`,
      );

      response.setStructuredContent(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`[invoke-skill] Skill failed: ${errorMessage}`);
      response.setStructuredContent({
        success: false,
        error: errorMessage,
      });
    }
  },
});

/**
 * 列出所有可用技能
 */
export const listSkills = defineTool({
  name: 'list-skills',
  description: '列出所有可用的逆向工程技能',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
    title: 'List skills',
  },
  schema: {},
  handler: async (request, response, _context, _runtime) => {
    const registry = SkillRegistry.getInstance();
    const skills = registry.list();

    response.setStructuredContent({
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        category: s.category,
      })),
    });
  },
});
