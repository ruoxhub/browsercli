/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 技能执行上下文接口
 */
export interface SkillContext {
  /** 当前页面 URL */
  url?: string;
  /** 技能配置选项 */
  options?: Record<string, unknown>;
  /** 会话 ID */
  sessionId?: string;
}

/**
 * 技能执行结果接口
 */
export interface SkillResult {
  /** 是否成功 */
  success: boolean;
  /** 结果消息 */
  message?: string;
  /** 错误信息 */
  error?: string;
  /** 返回数据 */
  data?: unknown;
}

/**
 * 技能定义接口
 */
export interface SkillDefinition {
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能类别 */
  category: 'observe' | 'hook' | 'debug' | 'extract' | 'rebuild';
  /** 技能执行函数 */
  execute: (context: SkillContext) => Promise<SkillResult>;
}

/**
 * 技能注册表
 */
export class SkillRegistry {
  private static instance: SkillRegistry;
  private skills: Map<string, SkillDefinition> = new Map();

  private constructor() {}

  static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  /**
   * 注册技能
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * 获取技能
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * 列出所有技能
   */
  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }
}

/**
 * 技能执行器
 */
export class SkillRunner {
  /**
   * 执行技能
   */
  async run(skillName: string, context: SkillContext): Promise<SkillResult> {
    const registry = SkillRegistry.getInstance();
    const skill = registry.get(skillName);

    if (!skill) {
      return {
        success: false,
        error: `技能不存在：${skillName}`,
      };
    }

    try {
      return await skill.execute(context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
