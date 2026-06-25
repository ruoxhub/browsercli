/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest, ToolProfile} from '../manifest.js';

/**
 * MCP 工具注册表。收集所有 defineTool 定义，按 toolProfile 过滤暴露给客户端。
 *
 * @see {@link src/tools/ToolDefinition.ts} — defineTool 宏
 * @see {@link src/tools/categories.ts} — ToolCategory 分类枚举
 * @see {@link src/cli/commands/start.ts} — 启动时注册所有工具到 ToolRegistry
 */

const PROFILE_ORDER: Record<ToolProfile, number> = {
  search: 0,
  workflow: 1,
  full: 2,
};

export interface RegisteredToolEntry {
  domain: string;
  modulePath: string;
  handlerName: string;
  profile: ToolProfile;
  dependencies?: string[];
  prerequisites?: DomainManifest['prerequisites'][string];
  toolDependencies?: DomainManifest['toolDependencies'];
  sceneKeywords?: string[];
  workflowRule?: DomainManifest['workflowRule'];
}

export class ToolRegistry {
  constructor(private readonly manifests: readonly DomainManifest[]) {}

  listTools(profile: ToolProfile = 'full'): RegisteredToolEntry[] {
    const maxProfile = PROFILE_ORDER[profile];

    return this.manifests.flatMap(manifest =>
      manifest.tools
        .filter(tool => {
          const effectiveProfile = this.getEffectiveProfile(manifest, tool);
          return PROFILE_ORDER[effectiveProfile] <= maxProfile;
        })
        .map(tool => ({
          domain: manifest.name,
          modulePath: tool.modulePath,
          handlerName: tool.handlerName,
          profile: this.getEffectiveProfile(manifest, tool),
          dependencies: manifest.dependencies,
          ...(manifest.prerequisites?.[tool.handlerName]
            ? {prerequisites: manifest.prerequisites[tool.handlerName]}
            : {}),
          ...(manifest.toolDependencies
            ? {toolDependencies: manifest.toolDependencies}
            : {}),
          ...(manifest.sceneKeywords?.[tool.handlerName]
            ? {sceneKeywords: manifest.sceneKeywords[tool.handlerName]}
            : {}),
          ...(manifest.workflowRule
            ? {workflowRule: manifest.workflowRule}
            : {}),
        })),
    );
  }

  private getEffectiveProfile(
    manifest: DomainManifest,
    tool: DomainManifest['tools'][number],
  ): ToolProfile {
    return tool.profile ?? manifest.profile ?? 'workflow';
  }
}
