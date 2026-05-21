/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WorkflowStepContract {
  id: string;
  toolName: string;
  description: string;
  prerequisites: string[];
  expectedInputs?: Record<string, string>;
  parallel?: boolean;
}

export interface WorkflowRouteContract {
  patterns: RegExp[];
  priority: number;
  requiredDomains: string[];
  hint: string;
}

export interface WorkflowContract {
  kind: 'workflow-contract';
  version: 1;
  id: string;
  displayName: string;
  description: string;
  route: WorkflowRouteContract;
  steps: WorkflowStepContract[];
}
