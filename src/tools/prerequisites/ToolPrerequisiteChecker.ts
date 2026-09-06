/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DebuggerManager} from '../../modules/debugger/DebuggerManager.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {
  globalPageHealthTracker,
  type PageHealthTracker,
} from '../../worker/context/PageHealthTracker.js';
import type {ToolPrerequisite} from '../manifest.js';
import type {ToolRuntimeRequirements} from '../ToolDefinition.js';

export interface ToolPrerequisiteContext {
  getBrowserContext?(): unknown | null;
  getContext?(): unknown | null;
  getBrowser?(): unknown | null;
  isBrowserConnected?(): boolean;
  getSelectedPage(): unknown | null;
  getSelectedFrame?(): unknown | null;
  getSelectedPageId?(): string | undefined;
  getPageId?(page: unknown): string;
  getExistingDebuggerContext?(
    page?: unknown,
  ):
    | DebuggerManager
    | {isPaused?(): boolean; getPausedState?(): unknown | null}
    | undefined;
  getDebuggerContext?: () => Promise<unknown>;
}

export class ToolPrerequisiteChecker {
  constructor(
    private readonly context: ToolPrerequisiteContext,
    private readonly pageHealthTracker: PageHealthTracker = globalPageHealthTracker,
  ) {}

  check(
    toolName: string,
    requirementsOrPrerequisites?:
      | ToolRuntimeRequirements
      | readonly ToolPrerequisite[],
    legacyPrerequisites?: readonly ToolPrerequisite[],
  ): void {
    let requirements: ToolRuntimeRequirements | undefined;
    let prerequisites: readonly ToolPrerequisite[] | undefined;

    if (Array.isArray(requirementsOrPrerequisites)) {
      prerequisites = requirementsOrPrerequisites;
    } else if (
      requirementsOrPrerequisites &&
      typeof requirementsOrPrerequisites === 'object'
    ) {
      requirements = requirementsOrPrerequisites as ToolRuntimeRequirements;
      prerequisites = legacyPrerequisites;
    }

    if (requirements) {
      // 1. Browser connection check
      if (requirements.browser === 'connected') {
        let browserConnected = false;
        if (typeof this.context.isBrowserConnected === 'function') {
          browserConnected = Boolean(this.context.isBrowserConnected());
        } else if (typeof this.context.getBrowserContext === 'function') {
          const ctx = this.context.getBrowserContext();
          browserConnected = ctx !== null && ctx !== undefined;
        } else if (typeof this.context.getContext === 'function') {
          const ctx = this.context.getContext();
          browserConnected = ctx !== null && ctx !== undefined;
        } else if (typeof this.context.getBrowser === 'function') {
          const browser = this.context.getBrowser();
          browserConnected = browser !== null && browser !== undefined;
        }

        if (!browserConnected) {
          throw createToolError(
            ErrorCodes.BROWSER_REQUIRED,
            `Tool "${toolName}" requires a connected browser.`,
            {toolName},
            {retryable: false},
          );
        }
      }

      // 2. Page selection check
      if (requirements.page === 'selected') {
        const page = this.context.getSelectedPage();
        if (!page) {
          throw createToolError(
            ErrorCodes.PAGE_REQUIRED,
            `Tool "${toolName}" requires an active page.`,
            {toolName},
            {retryable: false},
          );
        }
      }

      // 3. Frame selection check
      if (requirements.frame === 'selected') {
        const frame =
          typeof this.context.getSelectedFrame === 'function'
            ? this.context.getSelectedFrame()
            : null;
        if (!frame) {
          throw createToolError(
            ErrorCodes.FRAME_REQUIRED,
            `Tool "${toolName}" requires a selected frame.`,
            {toolName},
            {retryable: false},
          );
        }
      }
    }

    // 4. Page health check (unresponsive guard, bypassed when recovery is true)
    if (requirements?.recovery !== true) {
      const page = this.context.getSelectedPage();
      if (page) {
        let pageId: string | undefined;
        try {
          pageId =
            typeof this.context.getPageId === 'function'
              ? this.context.getPageId(page)
              : this.context.getSelectedPageId?.();
        } catch {
          pageId = undefined;
        }

        if (pageId && !this.pageHealthTracker.isPageHealthy(pageId)) {
          const record = this.pageHealthTracker.getRecord(pageId);
          throw createToolError(
            ErrorCodes.PAGE_UNRESPONSIVE,
            `页面 [${pageId}] 当前处于卡死状态 (UNRESPONSIVE: 连续 ${record?.consecutiveTimeouts ?? 0} 次超时)。请先调用 check_browser_health 探测页面状态，或通过浏览器重连恢复。`,
            {toolName, pageId, healthRecord: record},
            {retryable: true},
          );
        }
      }
    }

    if (requirements) {
      // 5. Debugger state check (read-only peek, never eager-enable CDP)
      if (
        requirements.debugger === 'running' ||
        requirements.debugger === 'paused'
      ) {
        const page = this.context.getSelectedPage();
        const debuggerManager =
          typeof this.context.getExistingDebuggerContext === 'function'
            ? this.context.getExistingDebuggerContext(page ?? undefined)
            : undefined;

        let isPaused = false;
        if (debuggerManager) {
          if (typeof debuggerManager.isPaused === 'function') {
            isPaused = debuggerManager.isPaused();
          } else if (typeof debuggerManager.getPausedState === 'function') {
            isPaused = debuggerManager.getPausedState() !== null;
          }
        }

        if (requirements.debugger === 'running' && isPaused) {
          throw createToolError(
            ErrorCodes.DEBUGGER_PAUSED,
            `Page execution is currently paused by the debugger. Tool "${toolName}" requires the page to be running.`,
            {toolName},
            {
              retryable: true,
              recovery: {
                tool: 'resume',
                command: 'proxycli call resume',
                reason: 'Resume execution or evaluate the current call frame.',
              },
            },
          );
        }

        if (requirements.debugger === 'paused' && !isPaused) {
          throw createToolError(
            ErrorCodes.DEBUGGER_NOT_PAUSED,
            `Page execution is not paused. Tool "${toolName}" requires the debugger to be paused.`,
            {toolName},
            {
              retryable: false,
              recovery: {
                tool: 'pause',
                command: 'proxycli call pause',
                reason: 'Pause page execution before inspecting call frames.',
              },
            },
          );
        }
      }
    }

    // 6. Legacy prerequisites check
    if (prerequisites && Array.isArray(prerequisites)) {
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
}
