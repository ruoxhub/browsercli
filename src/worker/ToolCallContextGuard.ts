/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ToolTabContext {
  url: string | null;
  title: string | null;
  tabIndex: number | null;
  pageId: string | null;
}

export interface ToolTabContextProvider {
  getContextMeta(): ToolTabContext;
}

const CONTEXT_SENSITIVE_PREFIXES = [
  'page',
  'navigation',
  'dom',
  'debugger',
  'network',
  'hook',
  'script',
  'console',
  'input',
  'frames',
  'screenshot',
] as const;

const MAX_CONSECUTIVE_REPEATS = 3;

export class ToolCallContextGuard {
  private readonly contextSensitiveCache = new Map<string, boolean>();
  private lastToolName: string | null = null;
  private consecutiveCount = 0;

  constructor(
    private readonly getProvider: () => ToolTabContextProvider | null,
  ) {}

  recordCall(toolName: string): number {
    if (toolName === this.lastToolName) {
      this.consecutiveCount++;
    } else {
      this.lastToolName = toolName;
      this.consecutiveCount = 1;
    }
    return this.consecutiveCount;
  }

  enrichResponse<T>(toolName: string, response: T): T {
    if (typeof response !== 'object' || response === null) return response;

    const target = response as Record<string, unknown>;
    const structured =
      typeof target.structuredContent === 'object' &&
      target.structuredContent !== null
        ? (target.structuredContent as Record<string, unknown>)
        : target;

    if (this.consecutiveCount >= MAX_CONSECUTIVE_REPEATS) {
      structured.repeatWarning = `Tool "${toolName}" was called ${this.consecutiveCount} times consecutively. Check whether a different observation or navigation tool is needed.`;
    }

    if (!this.isContextSensitive(toolName)) return response;

    const provider = this.getProvider();
    if (!provider) return response;

    const meta = provider.getContextMeta();
    if (!meta.pageId && meta.tabIndex === null) return response;

    if (!('_tabContext' in structured)) {
      structured._tabContext = meta;
    }

    return response;
  }

  private isContextSensitive(toolName: string): boolean {
    const cached = this.contextSensitiveCache.get(toolName);
    if (cached !== undefined) return cached;

    const lower = toolName.toLowerCase();
    const result = CONTEXT_SENSITIVE_PREFIXES.some(prefix =>
      lower.startsWith(prefix),
    );
    this.contextSensitiveCache.set(toolName, result);
    return result;
  }
}
