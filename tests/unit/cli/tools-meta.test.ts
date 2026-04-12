/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  getAllToolNames,
  getToolMeta,
  searchTools,
  TOOLS_META,
} from '../../../src/cli/tools-meta.js';

describe('tools-meta', () => {
  describe('TOOLS_META', () => {
    it('is a non-empty array', () => {
      assert.ok(Array.isArray(TOOLS_META));
      assert.ok(TOOLS_META.length > 0);
    });

    it('has expected tool count', () => {
      assert.ok(
        TOOLS_META.length >= 80,
        `Expected >= 80 tools, got ${TOOLS_META.length}`,
      );
    });

    it('every tool has required fields', () => {
      for (const tool of TOOLS_META) {
        assert.ok(tool.name, `Tool missing name: ${JSON.stringify(tool)}`);
        assert.ok(tool.description, `Tool missing description: ${tool.name}`);
        assert.ok(
          typeof tool.schema === 'object',
          `Tool missing schema: ${tool.name}`,
        );
        assert.ok(tool.modulePath, `Tool missing modulePath: ${tool.name}`);
        assert.ok(tool.handlerName, `Tool missing handlerName: ${tool.name}`);
      }
    });

    it('all tool names are unique', () => {
      const names = TOOLS_META.map(t => t.name);
      const uniqueNames = new Set(names);
      assert.strictEqual(
        names.length,
        uniqueNames.size,
        'Duplicate tool names found',
      );
    });

    it('all tool names are lowercase', () => {
      for (const tool of TOOLS_META) {
        assert.strictEqual(
          tool.name,
          tool.name.toLowerCase(),
          `Tool name not lowercase: ${tool.name}`,
        );
      }
    });

    it('all tool names use underscores (not hyphens)', () => {
      for (const tool of TOOLS_META) {
        assert.ok(
          !tool.name.includes('-'),
          `Tool name contains hyphen: ${tool.name}`,
        );
      }
    });

    it('no duplicate modulePath + handlerName combinations', () => {
      const combos = TOOLS_META.map(t => `${t.modulePath}:${t.handlerName}`);
      const uniqueCombos = new Set(combos);
      assert.strictEqual(
        combos.length,
        uniqueCombos.size,
        'Duplicate modulePath:handlerName found',
      );
    });

    it('contains known core tools', () => {
      const names = TOOLS_META.map(t => t.name);
      assert.ok(names.includes('invoke_skill'));
      assert.ok(names.includes('list_skills'));
      assert.ok(names.includes('query_dom'));
      assert.ok(names.includes('hook_function'));
      assert.ok(names.includes('list_network_requests'));
    });
  });

  describe('getToolMeta', () => {
    it('returns meta for existing tool', () => {
      const meta = getToolMeta('query_dom');
      assert.ok(meta);
      assert.strictEqual(meta!.name, 'query_dom');
      assert.strictEqual(meta!.modulePath, './dom.js');
    });

    it('returns undefined for non-existing tool', () => {
      const meta = getToolMeta('nonexistent_tool_xyz');
      assert.strictEqual(meta, undefined);
    });

    it('returns correct handlerName', () => {
      const meta = getToolMeta('list_skills');
      assert.ok(meta);
      assert.strictEqual(meta!.handlerName, 'listSkills');
    });
  });

  describe('getAllToolNames', () => {
    it('returns array of strings', () => {
      const names = getAllToolNames();
      assert.ok(Array.isArray(names));
      assert.ok(names.length > 0);
      assert.ok(typeof names[0] === 'string');
    });

    it('matches TOOLS_META length', () => {
      const names = getAllToolNames();
      assert.strictEqual(names.length, TOOLS_META.length);
    });

    it('contains same names as TOOLS_META', () => {
      const names = getAllToolNames();
      const metaNames = TOOLS_META.map(t => t.name);
      assert.deepStrictEqual(names.sort(), metaNames.sort());
    });
  });

  describe('searchTools', () => {
    it('finds tools by name substring', () => {
      const results = searchTools('dom');
      assert.ok(results.length > 0);
      for (const tool of results) {
        assert.ok(tool.name.includes('dom') || tool.name.includes('DOM'));
      }
    });

    it('finds tools by description', () => {
      const results = searchTools('网络');
      assert.ok(results.length > 0);
    });

    it('returns empty array for no match', () => {
      const results = searchTools('zzz_nonexistent_term_xyz');
      assert.deepStrictEqual(results, []);
    });

    it('is case-insensitive for name search', () => {
      const lowerResults = searchTools('dom');
      const upperResults = searchTools('DOM');
      assert.deepStrictEqual(lowerResults, upperResults);
    });
  });
});
