/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ToolEntry {
  /**
   * Path relative to src/tools/, using the emitted .js extension.
   */
  modulePath: string;
  /**
   * Named export containing the ToolDefinition.
   */
  handlerName: string;
  profile?: ToolProfile;
}

export type ToolProfile = 'workflow' | 'full';

export interface ToolPrerequisite {
  condition: 'requiresPage' | 'requiresDebugger' | 'requiresHookStore' | string;
  fix: string;
}

export interface ToolDependency {
  from: string;
  to: string;
  relation: 'requires' | 'precedes' | 'suggests' | 'uses' | 'extends';
  weight?: number;
}

export interface WorkflowRule {
  patterns: readonly RegExp[];
  priority: number;
  tools: readonly string[];
  hint: string;
}

export interface DomainManifest {
  name: string;
  description: string;
  version?: 1;
  profile?: ToolProfile;
  dependencies?: string[];
  prerequisites?: Record<string, ToolPrerequisite[]>;
  toolDependencies?: ToolDependency[];
  sceneKeywords?: Record<string, string[]>;
  workflowRule?: WorkflowRule;
  tools: ToolEntry[];
}
