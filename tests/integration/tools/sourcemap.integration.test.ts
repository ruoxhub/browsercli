import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it} from 'node:test';

import {SourceMapService} from '../../../src/modules/sourcemap/SourceMapService.js';
import type {
  SourceMapConfig,
  SourceMapRuntimeAccess,
} from '../../../src/modules/sourcemap/types.js';

const BASIC_MAP = JSON.stringify({
  version: 3,
  sources: ['src/main.ts'],
  sourcesContent: ['export const main = true;\n'],
  names: [],
  mappings: 'AAAA',
});

const CHANGED_MAP = JSON.stringify({
  version: 3,
  sources: ['src/main.ts', 'src/extra.ts'],
  sourcesContent: ['export const main = true;\n', 'export const extra = 1;\n'],
  names: [],
  mappings: 'AAAA;ACAA',
});

const INTEGRATION_CONFIG: SourceMapConfig = {
  maxBytes: 1024 * 1024,
  cacheMaxBytes: 4 * 1024 * 1024,
  cacheMaxEntries: 8,
  cacheTtlMs: 60_000,
  fetchTimeoutMs: 1000,
  maxRedirects: 3,
  maxIndexedDepth: 8,
  maxIndexedSections: 1000,
  maxDiffChanges: 2000,
};

function createIntegrationHarness() {
  let requests = 0;
  let ids = 0;
  const mapUrl = 'https://example.com/app.js.map';
  const access: SourceMapRuntimeAccess = {
    listScripts: () => [
      {
        scriptId: 'script-1',
        generatedUrl: 'https://example.com/app.js',
        sourceMapURL: mapUrl,
      },
    ],
    findCapturedBody: async url =>
      url === mapUrl ? {url, content: BASIC_MAP, complete: true} : undefined,
    getCookies: async () => [],
    getPageUrl: () => 'https://example.com/app.js',
    resolveExistingTaskDir: async () => undefined,
  };
  const service = new SourceMapService(INTEGRATION_CONFIG, {
    randomBytes: size => Buffer.alloc(size, (ids += 1)),
    resolverDependencies: {
      lookup: async () => [{address: '93.184.216.34', family: 4}],
      request: async () => {
        requests += 1;
        throw new Error('captured body should prevent a request');
      },
    },
  });
  return {service, access, getRequestCount: () => requests};
}

it('runs the explicit SourceMap workflow without implicit writes', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-flow-'));
  const {service, access, getRequestCount} = createIntegrationHarness();
  const discovered = service.discover({}, access);
  assert.equal(discovered.candidates[0]?.scriptId, 'script-1');

  const first = await service.parse({scriptId: 'script-1'}, access);
  const second = await service.parse({mapContent: CHANGED_MAP}, access);
  assert.equal(
    service.lookup({
      mapId: first.mapId,
      direction: 'generated_to_original',
      line: 1,
      column: 0,
    }).match?.line,
    1,
  );
  assert.equal(
    service.diff({leftMapId: first.mapId, rightMapId: second.mapId})
      .summaryChanged,
    true,
  );
  assert.deepEqual(await readdir(outputDir), []);
  assert.equal(getRequestCount(), 0);

  const tree = await service.reconstructTree(
    {mapId: first.mapId, outputDir, overwrite: false},
    access,
  );
  assert.equal(
    JSON.parse(await readFile(tree.manifestPath, 'utf8')).mapId,
    first.mapId,
  );
});
