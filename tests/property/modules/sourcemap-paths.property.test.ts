import assert from 'node:assert/strict';
import path from 'node:path';
import {it} from 'node:test';

import fc from 'fast-check';

import {normalizeSourcePath} from '../../../src/modules/sourcemap/SourceMapReconstructor.js';
import {SourceMapService} from '../../../src/modules/sourcemap/SourceMapService.js';
import type {
  SourceMapConfig,
  SourceMapRuntimeAccess,
} from '../../../src/modules/sourcemap/types.js';

const PROPERTY_CONFIG: SourceMapConfig = {
  maxBytes: 4096,
  cacheMaxBytes: 8192,
  cacheMaxEntries: 2,
  cacheTtlMs: 60_000,
  fetchTimeoutMs: 1000,
  maxRedirects: 3,
  maxIndexedDepth: 8,
  maxIndexedSections: 1000,
  maxDiffChanges: 2000,
};

const PROPERTY_ACCESS: SourceMapRuntimeAccess = {
  listScripts: () => [],
  findCapturedBody: async () => undefined,
  getCookies: async () => [],
  getPageUrl: () => undefined,
  resolveExistingTaskDir: async () => undefined,
};

it('never produces an absolute or escaping source path', () => {
  fc.assert(
    fc.property(fc.string(), fc.nat(), (source, index) => {
      const normalized = normalizeSourcePath(source, index);
      assert.equal(path.isAbsolute(normalized), false);
      assert.equal(normalized.split('/').includes('..'), false);
      assert.ok(normalized.length > 0);
    }),
    {numRuns: 1000},
  );
});

it('keeps cache entry and byte limits under arbitrary parse sequences', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({maxLength: 32}), {maxLength: 100}),
      async contents => {
        const service = new SourceMapService(PROPERTY_CONFIG);
        for (const [index, content] of contents.entries()) {
          await service.parse(
            {
              mapContent: JSON.stringify({
                version: 3,
                sources: [`source-${index}.ts`],
                sourcesContent: [content],
                names: [],
                mappings: 'AAAA',
              }),
            },
            PROPERTY_ACCESS,
          );
          const stats = service.getCacheStats();
          assert.ok(stats.entries <= PROPERTY_CONFIG.cacheMaxEntries);
          assert.ok(stats.bytes <= PROPERTY_CONFIG.cacheMaxBytes);
        }
      },
    ),
    {numRuns: 100},
  );
});
