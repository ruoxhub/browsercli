/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_ALIASES,
  TOOL_ALIASES,
  getAliasesForTool,
  levenshtein,
  suggestSimilarKeys,
} from '../../../src/cli/tool-aliases.js';

describe('tool-aliases 别名注册表', () => {
  describe('getAliasesForTool', () => {
    it('包含全局别名', () => {
      const aliases = getAliasesForTool('unknown_tool');
      assert.equal(aliases.depth, 'maxDepth');
      assert.equal(aliases.keyword, 'pattern');
    });

    it('工具专有别名覆盖全局别名', () => {
      // analyze_target 中 keywords → topN（而非全局的 pattern）
      const aliases = getAliasesForTool('analyze_target');
      assert.equal(aliases.keywords, 'topN');
    });

    it('为已注册工具合并全局 + 专有别名', () => {
      const aliases = getAliasesForTool('search_in_scripts');
      assert.equal(aliases.keyword, 'pattern');
      assert.equal(aliases.query, 'pattern');
      // 全局别名也存在
      assert.equal(aliases.depth, 'maxDepth');
    });
  });

  describe('levenshtein', () => {
    it('相同字符串距离为 0', () => {
      assert.equal(levenshtein('pattern', 'pattern'), 0);
    });

    it('空字符串情形', () => {
      assert.equal(levenshtein('', 'abc'), 3);
      assert.equal(levenshtein('abc', ''), 3);
      assert.equal(levenshtein('', ''), 0);
    });

    it('一个字符差异距离为 1', () => {
      assert.equal(levenshtein('keyword', 'keywords'), 1);
    });

    it('完全不同字符串距离等于较长者长度', () => {
      // 'abc' 和 'xyz' 需要 3 次替换
      assert.equal(levenshtein('abc', 'xyz'), 3);
    });
  });

  describe('suggestSimilarKeys', () => {
    const candidates = ['pattern', 'topN', 'hookPreset', 'maxDepth'];

    it('返回最相近的候选', () => {
      const suggestions = suggestSimilarKeys('patern', candidates);
      assert.ok(suggestions.includes('pattern'));
    });

    it('完全无关的输入返回空或极少结果', () => {
      const suggestions = suggestSimilarKeys('xyzzyx', candidates);
      // 不应该把所有候选都建议上
      assert.ok(suggestions.length <= 3);
    });

    it('限制返回数量不超过 limit', () => {
      const suggestions = suggestSimilarKeys('x', candidates, 2);
      assert.ok(suggestions.length <= 2);
    });

    it('大小写不敏感', () => {
      const suggestions = suggestSimilarKeys('PATTERN', candidates);
      assert.ok(suggestions.includes('pattern'));
    });
  });

  describe('注册表完整性', () => {
    it('所有问题报告中的别名已覆盖', () => {
      const expected: Array<[string, string, string]> = [
        ['analyze_target', 'keywords', 'topN'],
        ['search_in_scripts', 'keyword', 'pattern'],
        ['list_network_requests', 'url', 'headerFilter'],
        ['collect_code', 'mode', 'smartMode'],
        ['get_dom_structure', 'depth', 'maxDepth'],
        ['query_dom', 'getInfo', 'all'],
        ['find_clickable_elements', 'page', 'filterText'],
      ];
      for (const [tool, alias, canonical] of expected) {
        const aliases = getAliasesForTool(tool);
        assert.equal(
          aliases[alias],
          canonical,
          `${tool} 应将 ${alias} 映射为 ${canonical}`,
        );
      }
    });

    it('GLOBAL_ALIASES 为冻结对象', () => {
      assert.ok(Object.isFrozen(GLOBAL_ALIASES));
    });

    it('TOOL_ALIASES 为冻结对象', () => {
      assert.ok(Object.isFrozen(TOOL_ALIASES));
    });
  });
});
