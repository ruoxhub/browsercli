/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {SkillRegistry, SkillRunner} from '../../skills/index.js';

/** Skill 操作统一返回结构 */
export interface SkillResult {
  success: boolean;
  message: string;
  tooltype: string;
  logFormat?: string;
}

/** 调用技能参数 */
export interface InvokeSkillParams {
  skillName: string;
  options?: Record<string, unknown>;
  url?: string;
}

/** 调用技能结果 */
export interface InvokeSkillResult extends SkillResult {
  tooltype: 'invoke_skill';
  result?: unknown;
  availableSkills?: Array<{name: string; description: string; category: string}>;
}

/** 列出技能结果 */
export interface ListSkillsResult extends SkillResult {
  tooltype: 'list_skills';
  skills: Array<{name: string; description: string; category: string}>;
}

/**
 * 调用已注册的逆向工程技能。
 *
 * @param params - 技能调用参数
 * @returns 结构化结果对象
 */
export async function invokeSkill(
  params: InvokeSkillParams,
): Promise<InvokeSkillResult> {
  const {skillName, options = {}, url} = params;

  try {
    const registry = SkillRegistry.getInstance();
    const skill = registry.get(skillName);

    if (!skill) {
      const availableSkills = registry.list();
      return {
        success: false,
        message: `技能不存在：${skillName}`,
        tooltype: 'invoke_skill',
        availableSkills: availableSkills.map(s => ({
          name: s.name,
          description: s.description,
          category: s.category,
        })),
      };
    }

    const runner = new SkillRunner();
    const result = await runner.run(skillName, {url, options});

    return {
      success: result.success,
      message: result.success
        ? `技能 ${skillName} 执行完成`
        : `技能 ${skillName} 执行失败`,
      tooltype: 'invoke_skill',
      result,
    };
  } catch (error) {
    return {
      success: false,
      message: `技能调用失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'invoke_skill',
    };
  }
}

/**
 * 列出所有可用技能。
 *
 * 纯函数：不依赖 MCP 框架。
 */
export function listSkills(): ListSkillsResult {
  const registry = SkillRegistry.getInstance();
  const skills = registry.list();

  return {
    success: true,
    message: `共 ${skills.length} 个可用技能`,
    tooltype: 'list_skills',
    skills: skills.map(s => ({
      name: s.name,
      description: s.description,
      category: s.category,
    })),
  };
}
