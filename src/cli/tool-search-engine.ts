/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ToolMeta} from './tools-meta.js';

export interface ToolSearchOptions {
  limit?: number;
}

interface SearchDoc {
  tool: ToolMeta;
  weightedTokens: Map<string, number>;
}

export class ToolSearchEngine {
  private readonly docs: SearchDoc[];

  constructor(tools: readonly ToolMeta[]) {
    this.docs = tools.map(tool => ({
      tool,
      weightedTokens: this.buildTokens(tool),
    }));
  }

  search(query: string, options: ToolSearchOptions = {}): ToolMeta[] {
    const queryTokens = this.tokenize(query);
    const scored = this.docs
      .map(doc => ({
        tool: doc.tool,
        score:
          this.score(doc, queryTokens) +
          (this.matchesLegacySubstring(doc.tool, query) ? 100 : 0),
      }))
      .filter(item => item.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
      );

    const legacyBoundary =
      queryTokens.length === 1
        ? scored.filter(item => this.matchesLegacySubstring(item.tool, query))
        : scored;

    return legacyBoundary.slice(0, options.limit ?? 20).map(item => item.tool);
  }

  private score(doc: SearchDoc, queryTokens: string[]): number {
    let score = 0;
    for (const token of queryTokens) {
      score += doc.weightedTokens.get(token) ?? 0;
    }
    return score;
  }

  private matchesLegacySubstring(tool: ToolMeta, query: string): boolean {
    const lower = query.toLowerCase();
    return (
      tool.name.toLowerCase().includes(lower) ||
      tool.description.toLowerCase().includes(lower)
    );
  }

  private buildTokens(tool: ToolMeta): Map<string, number> {
    const tokens = new Map<string, number>();
    const add = (value: string | undefined, weight: number) => {
      for (const token of this.tokenize(value ?? '')) {
        tokens.set(token, Math.max(tokens.get(token) ?? 0, weight));
      }
    };

    add(tool.name, 3);
    add(tool.domain, 2);
    add(tool.description, 1);
    for (const keyword of tool.sceneKeywords ?? []) add(keyword, 2);
    for (const [name, spec] of Object.entries(tool.argSpecs)) {
      add(name, 1.5);
      add(spec.description, 1);
    }
    return tokens;
  }

  private tokenize(value: string): string[] {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/u)
      .filter(Boolean);
  }
}
