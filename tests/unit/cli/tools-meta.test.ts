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

    it('no duplicate modulePath + handlerName combinations except documented aliases', () => {
      const allowedAliases = new Set([
        './hook/InjectHook.js:injectHook',
        './script/script.js:evaluateScriptFn',
      ]);
      const seen = new Map<string, string>();

      for (const tool of TOOLS_META) {
        const combo = `${tool.modulePath}:${tool.handlerName}`;
        const previous = seen.get(combo);
        if (previous && !allowedAliases.has(combo)) {
          assert.fail(
            `Duplicate modulePath:handlerName found: ${combo} (${previous}, ${tool.name})`,
          );
        }
        seen.set(combo, tool.name);
      }
    });

    it('contains known core tools', () => {
      const names = TOOLS_META.map(t => t.name);
      assert.ok(names.includes('observe_flow'));
      assert.ok(names.includes('auto_hook'));
      assert.ok(names.includes('rebuild_bundle'));
      assert.ok(names.includes('query_dom'));
      assert.ok(names.includes('hook_function'));
      assert.ok(names.includes('list_network_requests'));
      assert.ok(!names.includes('list_console_messages'));
      assert.ok(!names.includes('get_console_message'));
      assert.ok(!names.includes('list_websocket_connections'));
      assert.ok(!names.includes('get_websocket_messages'));
      assert.ok(!names.includes('get_websocket_message'));
      assert.ok(!names.includes('analyze_websocket_messages'));
    });

    it('contains migrated wasm tools', () => {
      const names = TOOLS_META.map(t => t.name);
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
    it('returns meta for existing tool', () => {
      const meta = getToolMeta('query_dom');
      assert.ok(meta);
      assert.strictEqual(meta!.name, 'query_dom');
      assert.strictEqual(meta!.modulePath, './dom/queryDom.js');
    });

    it('returns undefined for non-existing tool', () => {
      const meta = getToolMeta('nonexistent_tool_xyz');
      assert.strictEqual(meta, undefined);
    });

    it('returns correct handlerName', () => {
      const meta = getToolMeta('auto_hook');
      assert.ok(meta);
      assert.strictEqual(meta!.handlerName, 'autoHook');
    });

    it('uses the corrected vjstools module path', () => {
      const meta = getToolMeta('deobfuscate_code_vj');
      assert.ok(meta);
      assert.strictEqual(meta!.modulePath, './vjstools/deobfuscate.js');
    });

    it('includes required debugger params for get_script_source', () => {
      const meta = getToolMeta('get_script_source');
      assert.ok(meta);
      assert.deepStrictEqual(meta!.schema, {scriptId: 'string'});
    });

    it('describes evaluate_script passthrough schema', () => {
      const meta = getToolMeta('evaluate_script');
      assert.ok(meta);
      assert.match(meta!.description, /上下文/);
      assert.match(meta!.description, /verbose/);
      assert.deepStrictEqual(meta!.schema, {
        function: 'string',
        context: 'string',
        verbose: 'boolean',
      });
    });

    it('describes scroll_by supported params', () => {
      const meta = getToolMeta('scroll_by');
      assert.ok(meta);
      assert.deepStrictEqual(meta!.schema, {
        direction: 'string',
        pixels: 'number',
      });
    });

    it('describes list_network_requests pagination and target page params', () => {
      const meta = getToolMeta('list_network_requests');
      assert.ok(meta);
      assert.match(meta!.description, /targetPageIdx/);
      assert.deepStrictEqual(meta!.schema, {
        pageSize: 'number',
        pageIdx: 'number',
        targetPageIdx: 'number',
        resourceTypes: 'string[]',
        includePreservedRequests: 'boolean',
        waitForRequest: 'string',
        waitTimeoutMs: 'number',
        headerFilter: 'string',
      });
    });

    it('describes wasm_offline_run params', () => {
      const meta = getToolMeta('wasm_offline_run');
      assert.ok(meta);
      assert.strictEqual(meta!.modulePath, './wasm/index.js');
      assert.strictEqual(meta!.handlerName, 'wasmOfflineRun');
      assert.strictEqual(meta!.callMode, 'runtime');
      assert.deepStrictEqual(meta!.schema, {
        inputPath: 'string',
        functionName: 'string',
        args: 'string[]',
        runtime: 'string',
        timeoutMs: 'number',
      });
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
