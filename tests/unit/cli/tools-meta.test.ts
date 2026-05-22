/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  ensureToolsMeta,
  getAllToolNames,
  getAllToolsMeta,
  getToolMeta,
  searchTools,
} from '../../../src/cli/tools-meta.js';

describe('tools-meta', () => {
  describe('dynamic loading from defineTool', () => {
    it('loads all tools from defineTool definitions', async () => {
      await ensureToolsMeta();
      const tools = getAllToolsMeta();
      assert.ok(Array.isArray(tools));
      assert.ok(tools.length > 0);
    });

    it('has expected tool count', async () => {
      await ensureToolsMeta();
      const tools = getAllToolsMeta();
      assert.ok(
        tools.length >= 80,
        `Expected >= 80 tools, got ${tools.length}`,
      );
    });

    it('every tool has required fields', async () => {
      await ensureToolsMeta();
      const tools = getAllToolsMeta();
      for (const tool of tools) {
        assert.ok(tool.name, `Tool missing name: ${JSON.stringify(tool)}`);
        assert.ok(tool.description, `Tool missing description: ${tool.name}`);
        assert.ok(
          typeof tool.schema === 'object',
          `Tool missing schema: ${tool.name}`,
        );
        assert.ok(tool.modulePath, `Tool missing modulePath: ${tool.name}`);
        assert.ok(tool.handlerName, `Tool missing handlerName: ${tool.name}`);
        assert.ok(tool.argSpecs, `Tool missing argSpecs: ${tool.name}`);
      }
    });

    it('all tool names are unique', async () => {
      await ensureToolsMeta();
      const tools = getAllToolsMeta();
      const names = tools.map(t => t.name);
      const uniqueNames = new Set(names);
      assert.strictEqual(
        names.length,
        uniqueNames.size,
        'Duplicate tool names found',
      );
    });

    it('all tool names are lowercase', async () => {
      await ensureToolsMeta();
      const tools = getAllToolsMeta();
      for (const tool of tools) {
        assert.strictEqual(
          tool.name,
          tool.name.toLowerCase(),
          `Tool name not lowercase: ${tool.name}`,
        );
      }
    });

    it('all tool names use underscores (not hyphens)', async () => {
      await ensureToolsMeta();
      const tools = getAllToolsMeta();
      for (const tool of tools) {
        assert.ok(
          !tool.name.includes('-'),
          `Tool name contains hyphen: ${tool.name}`,
        );
      }
    });

    it('contains known core tools', async () => {
      await ensureToolsMeta();
      const names = getAllToolsMeta().map(t => t.name);
      assert.ok(names.includes('observe_flow'));
      assert.ok(names.includes('auto_hook'));
      assert.ok(names.includes('rebuild_bundle'));
      assert.ok(names.includes('query_dom'));
      assert.ok(names.includes('hook_function'));
      assert.ok(names.includes('list_network_requests'));
    });

    it('contains migrated wasm tools', async () => {
      await ensureToolsMeta();
      const names = getAllToolsMeta().map(t => t.name);
      assert.ok(names.includes('wasm_capabilities'));
      assert.ok(names.includes('wasm_dump'));
      assert.ok(names.includes('wasm_disassemble'));
      assert.ok(names.includes('wasm_decompile'));
      assert.ok(names.includes('wasm_inspect_sections'));
      assert.ok(names.includes('wasm_offline_run'));
      assert.ok(names.includes('wasm_optimize'));
      assert.ok(names.includes('wasm_vmp_trace'));
      assert.ok(names.includes('wasm_memory_inspect'));
    });
  });

  describe('getToolMeta', () => {
    it('returns meta for existing tool', async () => {
      await ensureToolsMeta();
      const meta = getToolMeta('query_dom');
      assert.ok(meta);
      assert.strictEqual(meta!.name, 'query_dom');
      assert.strictEqual(meta!.modulePath, './dom/queryDom.js');
    });

    it('returns undefined for non-existing tool', async () => {
      await ensureToolsMeta();
      const meta = getToolMeta('nonexistent_tool_xyz');
      assert.strictEqual(meta, undefined);
    });

    it('returns correct handlerName', async () => {
      await ensureToolsMeta();
      const meta = getToolMeta('auto_hook');
      assert.ok(meta);
      assert.strictEqual(meta!.handlerName, 'autoHook');
    });

    it('includes argSpecs for scroll_by', async () => {
      await ensureToolsMeta();
      const meta = getToolMeta('scroll_by');
      assert.ok(meta);
      assert.ok(meta!.argSpecs.direction);
      assert.strictEqual(meta!.argSpecs.direction.type, 'string');
      assert.ok(meta!.argSpecs.direction.enum);
      assert.ok(meta!.argSpecs.direction.enum!.includes('up'));
      assert.ok(meta!.argSpecs.direction.enum!.includes('down'));
    });

    it('includes argSpecs for wasm_offline_run', async () => {
      await ensureToolsMeta();
      const meta = getToolMeta('wasm_offline_run');
      assert.ok(meta);
      assert.strictEqual(meta!.modulePath, './wasm/index.js');
      assert.strictEqual(meta!.handlerName, 'wasmOfflineRun');
      assert.strictEqual(meta!.callMode, 'defineTool');
      assert.ok(meta!.argSpecs.inputPath);
      assert.strictEqual(meta!.argSpecs.inputPath.type, 'string');
      assert.ok(meta!.argSpecs.inputPath.required);
    });
  });

  describe('getAllToolNames', () => {
    it('returns array of strings after initialization', async () => {
      await ensureToolsMeta();
      const names = getAllToolNames();
      assert.ok(Array.isArray(names));
      assert.ok(names.length > 0);
      assert.ok(typeof names[0] === 'string');
    });

    it('matches getAllToolsMeta length', async () => {
      await ensureToolsMeta();
      const names = getAllToolNames();
      const tools = getAllToolsMeta();
      assert.strictEqual(names.length, tools.length);
    });
  });

  describe('searchTools', () => {
    it('finds tools by name substring', async () => {
      const results = await searchTools('dom');
      assert.ok(results.length > 0);
      for (const tool of results) {
        assert.ok(
          tool.name.includes('dom') || tool.description.toLowerCase().includes('dom'),
        );
      }
    });

    it('returns empty array for no match', async () => {
      const results = await searchTools('zzz_nonexistent_term_xyz');
      assert.deepStrictEqual(results, []);
    });

    it('is case-insensitive for name search', async () => {
      const lowerResults = await searchTools('dom');
      const upperResults = await searchTools('DOM');
      assert.deepStrictEqual(lowerResults, upperResults);
    });
  });
});
