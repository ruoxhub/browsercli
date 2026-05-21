/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest, ToolProfile} from '../manifest.js';

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
