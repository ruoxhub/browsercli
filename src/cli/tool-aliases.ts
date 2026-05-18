/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool parameter alias registry
 *
 * 映射 LLM/用户常猜错的参数名 → 实际 schema 参数名。
 * 设计原则：
 *   - 只声明"别名 → 规范名"单向映射
 *   - 别名只在 schema 里不存在时才触发（不会遮蔽真正支持的同名参数）
 *   - 一个 tool 可同时使用全局别名和自己的专有别名
 */

/**
 * 全局通用别名：跨多个工具普遍存在的命名偏差。
 * key=用户常写的错名，value=规范名
 *
 * 例如：所有 `maxDepth` 的工具都容易被写成 `depth`。
 */
export const GLOBAL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  depth: 'maxDepth',
  keyword: 'pattern',
  keywords: 'pattern',
  query: 'pattern',
  regex: 'pattern',
  mode: 'smartMode',
  getInfo: 'all',
  page: 'filterText',
  filter: 'filterText',
});

/**
 * 工具专有别名：优先级高于全局别名
 * 结构：toolName → { aliasKey: canonicalKey }
 */
export const TOOL_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  analyze_target: {
    keywords: 'topN',
    keyword: 'topN',
    hook: 'hookPreset',
    preset: 'hookPreset',
  },
  search_in_scripts: {
    keyword: 'pattern',
    keywords: 'pattern',
    query: 'pattern',
    regex: 'pattern',
  },
  list_network_requests: {
    url: 'headerFilter',
    urlFilter: 'headerFilter',
    filter: 'headerFilter',
  },
  collect_code: {
    mode: 'smartMode',
  },
  get_dom_structure: {
    depth: 'maxDepth',
  },
  query_dom: {
    getInfo: 'all',
  },
  find_clickable_elements: {
    page: 'filterText',
    filter: 'filterText',
  },
  evaluate_script: {
    script: 'function',
    frame: 'frameId',
    anyFrame: 'allowAnyFrame',
    fallback: 'allowAnyFrame',
  },
  hook_fetch: {
    urlPattern: 'url',
    pattern: 'url',
    filter: 'url',
  },
});

/**
 * 查找 tool 的 alias 映射：专有别名覆盖全局别名
 */
export function getAliasesForTool(toolName: string): Record<string, string> {
  const toolSpecific = TOOL_ALIASES[toolName] ?? {};
  return {...GLOBAL_ALIASES, ...toolSpecific};
}

/**
 * Levenshtein distance：用于"did you mean"模糊建议
 * 只用于错误提示场景，性能非关键路径
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * 从候选参数名列表中给出 "did you mean" 建议（最多 3 个）
 * 阈值：编辑距离 ≤ 3 或 ≤ key.length / 2（取较大者）
 */
export function suggestSimilarKeys(
  input: string,
  candidates: readonly string[],
  limit = 3,
): string[] {
  const lowerInput = input.toLowerCase();
  const threshold = Math.max(3, Math.floor(input.length / 2));

  const scored: Array<{key: string; dist: number}> = [];
  for (const cand of candidates) {
    const dist = levenshtein(lowerInput, cand.toLowerCase());
    if (dist <= threshold) {
      scored.push({key: cand, dist});
    }
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, limit).map(s => s.key);
}
