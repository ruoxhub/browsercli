/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {createToolError, ErrorCodes} from '../../utils/errors.js';
import type {ToolPrerequisite} from '../manifest.js';

export interface ToolPrerequisiteContext {
  getSelectedPage(): unknown | null;
  getDebuggerContext?: () => Promise<unknown>;
}

export class ToolPrerequisiteChecker {
  constructor(private readonly context: ToolPrerequisiteContext) {}

  check(
    toolName: string,
    prerequisites: readonly ToolPrerequisite[] = [],
  ): void {
    for (const prerequisite of prerequisites) {
      if (
        prerequisite.condition === 'requiresPage' &&
        !this.context.getSelectedPage()
      ) {
        throw createToolError(
          ErrorCodes.PREREQUISITE,
          `Tool "${toolName}" requires an active page.`,
          {
            toolName,
            condition: prerequisite.condition,
            fix: prerequisite.fix,
          },
        );
      }
    }
  }
}
