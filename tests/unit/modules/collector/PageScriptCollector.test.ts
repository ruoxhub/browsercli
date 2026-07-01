/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {CollectedFileRegistry} from '../../../../src/modules/collector/CollectedFileRegistry.js';
import {PageScriptCollector} from '../../../../src/modules/collector/PageScriptCollector.js';

describe('PageScriptCollector', () => {
  describe('analyzeDependencies', () => {
    it('creates nodes for each file', () => {
      const collector = new PageScriptCollector();
      const files = [
        {
          url: 'https://x.com/a.js',
          content: '',
          size: 0,
          type: 'external' as const,
        },
        {
          url: 'https://x.com/b.js',
          content: '',
          size: 0,
          type: 'external' as const,
        },
      ];
      const graph = collector.analyzeDependencies(files);
      assert.strictEqual(graph.nodes.length, 2);
      assert.strictEqual(graph.edges.length, 0);
    });

    it('detects ES6 import dependencies and creates edges', () => {
      const collector = new PageScriptCollector();
      const files = [
        {
          url: 'https://x.com/main.js',
          content: `import { foo } from 'util';`,
          size: 30,
          type: 'external' as const,
        },
        {
          url: 'https://x.com/util.js',
          content: `export const foo = 1;`,
          size: 20,
          type: 'external' as const,
        },
      ];
      const graph = collector.analyzeDependencies(files);
      assert.strictEqual(graph.nodes.length, 2);
      assert.strictEqual(graph.edges.length, 1);
      assert.strictEqual(graph.edges[0]?.from, 'https://x.com/main.js');
      assert.strictEqual(graph.edges[0]?.to, 'https://x.com/util.js');
      assert.strictEqual(graph.edges[0]?.type, 'import');
    });

    it('detects CommonJS require dependencies', () => {
      const collector = new PageScriptCollector();
      const files = [
        {
          url: 'https://x.com/cjs.js',
          content: `const dep = require('dep');`,
          size: 30,
          type: 'external' as const,
        },
        {
          url: 'https://x.com/dep.js',
          content: `module.exports = {};`,
          size: 20,
          type: 'external' as const,
        },
      ];
      const graph = collector.analyzeDependencies(files);
      assert.strictEqual(graph.edges.length, 1);
      assert.strictEqual(graph.edges[0]?.from, 'https://x.com/cjs.js');
    });

    it('detects dynamic import dependencies', () => {
      const collector = new PageScriptCollector();
      const files = [
        {
          url: 'https://x.com/lazy.js',
          content: `import('chunk').then(m => m.run());`,
          size: 35,
          type: 'external' as const,
        },
        {
          url: 'https://x.com/chunk.js',
          content: `export const run = () => {};`,
          size: 25,
          type: 'external' as const,
        },
      ];
      const graph = collector.analyzeDependencies(files);
      assert.strictEqual(graph.edges.length, 1);
      assert.strictEqual(graph.edges[0]?.to, 'https://x.com/chunk.js');
    });

    it('returns empty graph for files with no dependencies', () => {
      const collector = new PageScriptCollector();
      const files = [
        {
          url: 'https://x.com/standalone.js',
          content: 'console.log("hi");',
          size: 18,
          type: 'external' as const,
        },
      ];
      const graph = collector.analyzeDependencies(files);
      assert.strictEqual(graph.nodes.length, 1);
      assert.strictEqual(graph.edges.length, 0);
    });
  });

  describe('collectInlineScripts', () => {
    it('collects inline scripts via page.evaluate and applies size limit', async () => {
      const collector = new PageScriptCollector();
      const registry = new CollectedFileRegistry({
        maxSingleFileSize: 50,
        maxFilesPerCollect: 10,
      });

      let capturedMaxSize: number | undefined;
      const page = {
        evaluate: async (fn: (maxSize: number) => unknown, maxSize: number) => {
          capturedMaxSize = maxSize;
          // Simulate the page.evaluate behavior — call fn with maxSize
          // In reality fn runs in browser, here we just return a mock result
          return [
            {
              url: 'inline-script-0',
              content: 'short',
              size: 5,
              type: 'inline' as const,
              metadata: {truncated: false, originalSize: undefined},
            },
          ];
        },
      } as unknown as Parameters<
        PageScriptCollector['collectInlineScripts']
      >[0];

      const files = await collector.collectInlineScripts(page, registry);
      assert.strictEqual(capturedMaxSize, 50);
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0]?.url, 'inline-script-0');
    });
  });
});
