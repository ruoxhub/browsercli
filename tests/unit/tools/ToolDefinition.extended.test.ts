/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {zod} from '../../../src/third_party/index.js';
import {ToolCategory} from '../../../src/tools/categories.js';
import {
  CLOSE_PAGE_ERROR,
  defineTool,
  timeoutSchema,
} from '../../../src/tools/ToolDefinition.js';
import {
  areRequirementsEqual,
  loadToolMeta,
} from '../../../src/tools/tools-meta.js';

describe('ToolDefinition extended', () => {
  it('defines tool and transforms timeout values', () => {
    const tool = defineTool({
      name: 'tmp_tool',
      description: 'temporary',
      annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
      schema: {
        ...timeoutSchema,
      },
      handler: async () => undefined,
    });

    assert.strictEqual(tool.name, 'tmp_tool');
    assert.strictEqual(tool.annotations.readOnlyHint, true);

    const schema = zod.object(tool.schema);
    const positive = schema.parse({timeout: 200});
    const zero = schema.parse({timeout: 0});
    const negative = schema.parse({timeout: -1});

    assert.strictEqual(positive.timeout, 200);
    assert.strictEqual(zero.timeout, 0);
    assert.strictEqual(negative.timeout, undefined);
  });

  it('exports close-page error text', () => {
    assert.ok(CLOSE_PAGE_ERROR.includes('last open page'));
  });

  it('defines tool with optional ToolRuntimeRequirements in annotations', () => {
    const tool = defineTool({
      name: 'click',
      description: 'click element',
      annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: false,
        requirements: {
          browser: 'connected',
          page: 'selected',
          frame: 'selected',
          debugger: 'running',
        },
      },
      schema: {},
      handler: async () => undefined,
    });

    assert.strictEqual(tool.name, 'click');
    assert.deepStrictEqual(tool.annotations.requirements, {
      browser: 'connected',
      page: 'selected',
      frame: 'selected',
      debugger: 'running',
    });
  });

  it('defines tool without requirements maintaining backward compatibility', () => {
    const tool = defineTool({
      name: 'no_reqs',
      description: 'no reqs',
      annotations: {
        category: ToolCategory.INPUT,
        readOnlyHint: true,
      },
      schema: {},
      handler: async () => undefined,
    });

    assert.strictEqual(tool.annotations.requirements, undefined);
  });

  describe('areRequirementsEqual', () => {
    it('compares requirement objects correctly', () => {
      assert.strictEqual(areRequirementsEqual(undefined, undefined), true);
      assert.strictEqual(
        areRequirementsEqual(
          {browser: 'connected', page: 'selected'},
          {browser: 'connected', page: 'selected'},
        ),
        true,
      );
      assert.strictEqual(
        areRequirementsEqual(
          {nativeTools: ['wasm-opt', 'wasm2wat']},
          {nativeTools: ['wasm2wat', 'wasm-opt']},
        ),
        true,
      );
      assert.strictEqual(
        areRequirementsEqual({debugger: 'paused'}, {debugger: 'running'}),
        false,
      );
      assert.strictEqual(
        areRequirementsEqual({browser: 'connected'}, undefined),
        false,
      );
      assert.strictEqual(
        areRequirementsEqual(
          {nativeTools: ['toolA']},
          {nativeTools: ['toolB']},
        ),
        false,
      );
    });
  });

  describe('loadToolMeta conflict rejection', () => {
    it('rejects conflicting entry and annotation requirements', async () => {
      const entry = {
        modulePath: './input/click.js',
        handlerName: 'click',
        domain: 'input',
        profile: 'workflow' as const,
        requirements: {
          browser: 'connected' as const,
          debugger: 'paused' as const,
        },
      };

      const result = await loadToolMeta(entry);
      assert.strictEqual(result, null);
    });

    it('loads matching representative tools with requirements', async () => {
      const clickMeta = await loadToolMeta({
        modulePath: './input/click.js',
        handlerName: 'click',
        domain: 'input',
        profile: 'workflow',
        requirements: {
          browser: 'connected',
          page: 'selected',
          frame: 'selected',
          debugger: 'running',
        },
      });
      assert.ok(clickMeta);
      assert.deepStrictEqual(clickMeta.requirements, {
        browser: 'connected',
        page: 'selected',
        frame: 'selected',
        debugger: 'running',
      });

      const listScriptsMeta = await loadToolMeta({
        modulePath: './debugger/index.js',
        handlerName: 'listScripts',
        domain: 'debugger',
        profile: 'full',
        requirements: {
          browser: 'connected',
          page: 'selected',
          debugger: 'available',
        },
      });
      assert.ok(listScriptsMeta);
      assert.deepStrictEqual(listScriptsMeta.requirements, {
        browser: 'connected',
        page: 'selected',
        debugger: 'available',
      });

      const resumeMeta = await loadToolMeta({
        modulePath: './debugger/index.js',
        handlerName: 'resume',
        domain: 'debugger',
        profile: 'full',
        requirements: {
          browser: 'connected',
          page: 'selected',
          debugger: 'available',
          recovery: true,
        },
      });
      assert.ok(resumeMeta);
      assert.deepStrictEqual(resumeMeta.requirements, {
        browser: 'connected',
        page: 'selected',
        debugger: 'available',
        recovery: true,
      });

      const evalMeta = await loadToolMeta({
        modulePath: './debugger/index.js',
        handlerName: 'evaluateOnCallframe',
        domain: 'debugger',
        profile: 'full',
        requirements: {
          browser: 'connected',
          page: 'selected',
          debugger: 'paused',
        },
      });
      assert.ok(evalMeta);
      assert.deepStrictEqual(evalMeta.requirements, {
        browser: 'connected',
        page: 'selected',
        debugger: 'paused',
      });

      const healthMeta = await loadToolMeta({
        modulePath: './page/checkBrowserHealth.js',
        handlerName: 'checkBrowserHealth',
        domain: 'page',
        profile: 'workflow',
        requirements: {
          browser: 'connected',
          recovery: true,
        },
      });
      assert.ok(healthMeta);
      assert.deepStrictEqual(healthMeta.requirements, {
        browser: 'connected',
        recovery: true,
      });

      const wasmDumpMeta = await loadToolMeta({
        modulePath: './wasm/index.js',
        handlerName: 'wasmDump',
        domain: 'wasm',
        profile: 'full',
      });
      assert.ok(wasmDumpMeta);
      assert.strictEqual(wasmDumpMeta.requirements, undefined);
    });
  });
});
