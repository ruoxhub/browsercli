/**
 * @license
 * Copyright 2026 JSReverser-MCP
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

export type ToolProfile = 'search' | 'workflow' | 'full';

export interface DomainManifest {
  name: string;
  description: string;
  profile?: ToolProfile;
  dependencies?: string[];
  tools: ToolEntry[];
}
