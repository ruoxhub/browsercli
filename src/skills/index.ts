/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {registerObserveFlowSkill} from './observe-flow.js';
import {registerAutoHookSkill} from './auto-hook.js';
import {registerRebuildBundleSkill} from './rebuild-bundle.js';

// 技能核心
export {SkillRegistry, SkillRunner, type SkillDefinition, type SkillContext, type SkillResult} from './SkillRunner.js';

// 技能配置类型
export type {ObserveFlowOptions} from './observe-flow.js';
export type {AutoHookOptions} from './auto-hook.js';
export type {RebuildBundleOptions} from './rebuild-bundle.js';

// 技能注册函数
export {registerObserveFlowSkill, registerAutoHookSkill, registerRebuildBundleSkill};

/**
 * 获取所有内置技能定义
 */
export function getBuiltInSkillDefinitions() {
  return [
    {name: 'observe-flow', description: '观察模式：收集和分析页面脚本', category: 'observe'},
    {name: 'auto-hook', description: '自动 Hook：注入调试 Hook 和加密库 Hook', category: 'hook'},
    {name: 'rebuild-bundle', description: '本地复现：构建 Node.js 环境复现目标代码', category: 'rebuild'},
  ];
}

/**
 * 注册所有内置技能到注册表
 */
export function registerBuiltInSkills(): void {
  registerObserveFlowSkill();
  registerAutoHookSkill();
  registerRebuildBundleSkill();
}
