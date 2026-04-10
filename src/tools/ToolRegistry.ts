/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {ToolCategory} from './categories.js';
import type {ToolDefinition} from './ToolDefinition.js';

export interface JSHookToolDefinition extends ToolDefinition {
  requiresAI?: boolean;
  requiresBrowser?: boolean;
}

export class ToolRegistry {
  private readonly tools = new Map<string, JSHookToolDefinition>();
  private readonly aliases = new Map<string, string>();

  register(tool: JSHookToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool name conflict: ${tool.name}`);
    }
    if (this.aliases.has(tool.name)) {
      throw new Error(`Tool name conflicts with alias: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    for (const alias of tool.aliases ?? []) {
      if (alias === tool.name) {
        continue;
      }
      if (this.tools.has(alias) || this.aliases.has(alias)) {
        throw new Error(`Tool alias conflict: ${alias}`);
      }
      this.aliases.set(alias, tool.name);
    }
  }

  /**
   * Auto-generate kebab-case aliases for all underscore tool names.
   * Called after all tools are registered to avoid alias conflicts.
   */
  autoGenerateKebabAliases(): void {
    const toAdd: Array<{tool: JSHookToolDefinition; kebabAlias: string}> = [];

    for (const tool of this.tools.values()) {
      if (!tool.name.includes('_')) continue;
      const kebabName = tool.name.replace(/_/g, '-');
      // Skip if tool already has this alias, or it conflicts with another tool/alias
      if (tool.aliases?.includes(kebabName)) continue;
      if (this.tools.has(kebabName)) continue;
      if (this.aliases.has(kebabName)) continue;
      // Check against other pending kebab aliases
      if (toAdd.some(a => a.kebabAlias === kebabName)) continue;
      toAdd.push({tool, kebabAlias: kebabName});
    }

    for (const {tool, kebabAlias} of toAdd) {
      const aliases = [...(tool.aliases ?? []), kebabAlias];
      this.tools.set(tool.name, {...tool, aliases});
      this.aliases.set(kebabAlias, tool.name);
    }
  }

  registerMany(tools: JSHookToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): JSHookToolDefinition | undefined {
    const canonical = this.aliases.get(name) ?? name;
    return this.tools.get(canonical);
  }

  getByCategory(category: ToolCategory): JSHookToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.annotations.category === category,
    );
  }

  values(): JSHookToolDefinition[] {
    return Array.from(this.tools.values());
  }

  aliasesFor(name: string): string[] {
    return Array.from(this.aliases.entries())
      .filter(([, canonical]) => canonical === name)
      .map(([alias]) => alias);
  }

  aliasEntries(): Array<{alias: string; canonical: string}> {
    return Array.from(this.aliases.entries()).map(([alias, canonical]) => ({
      alias,
      canonical,
    }));
  }

  validateName(name: string): boolean {
    return !this.tools.has(name) && !this.aliases.has(name);
  }
}
