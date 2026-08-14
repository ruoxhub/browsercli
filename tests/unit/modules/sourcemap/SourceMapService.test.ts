/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {SourceMapService} from '../../../../src/modules/sourcemap/SourceMapService.js';
import {
  type SourceMapConfig,
  SourceMapError,
  type SourceMapRuntimeAccess,
} from '../../../../src/modules/sourcemap/types.js';

const BASIC = JSON.stringify({
  version: 3,
  sources: ['src/main.ts'],
  sourcesContent: ['export const main = true;\n'],
  names: [],
  mappings: 'AAAA',
});

const TEST_CONFIG: SourceMapConfig = {
  maxBytes: 20 * 1024 * 1024,
  cacheMaxBytes: 64 * 1024 * 1024,
  cacheMaxEntries: 16,
  cacheTtlMs: 30 * 60 * 1000,
  fetchTimeoutMs: 15_000,
  maxRedirects: 3,
  maxIndexedDepth: 8,
  maxIndexedSections: 1000,
  maxDiffChanges: 2000,
};

function fakeAccess(taskDir?: string): SourceMapRuntimeAccess {
  return {
    listScripts: () => [],
    findCapturedBody: async () => undefined,
    getCookies: async () => [],
    getPageUrl: () => 'https://example.com/app.js',
    resolveExistingTaskDir: async taskId =>
      taskId === 'existing-task' ? taskDir : undefined,
  };
}

function createServiceHarness(overrides: Partial<SourceMapConfig> = {}) {
  let clock = 1000;
  let id = 0;
  const config: SourceMapConfig = {...TEST_CONFIG, ...overrides};
  const service = new SourceMapService(config, {
    now: () => clock,
    randomBytes: size => Buffer.alloc(size, (id += 1)),
    resolverDependencies: {
      lookup: async () => [{address: '93.184.216.34', family: 4}],
      request: async () => {
        throw new Error('unexpected network request');
      },
    },
  });
  return {
    service,
    access: fakeAccess(),
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

function mapWith(source: string, content: string): string {
  return JSON.stringify({
    version: 3,
    sources: [source],
    sourcesContent: [content],
    names: [],
    mappings: 'AAAA',
  });
}

describe('SourceMapService cache', () => {
  it('reuses an id for the same materialized map and base URL', async () => {
    const {service, access} = createServiceHarness();
    const first = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://a.test/app.js'},
      access,
    );
    const second = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://a.test/app.js'},
      access,
    );
    assert.equal(second.mapId, first.mapId);
    assert.equal(second.cacheHit, true);
    assert.match(first.mapId, /^sm_[a-f0-9]{32}$/);
  });

  it('does not reuse a map across different base URLs', async () => {
    const {service, access} = createServiceHarness();
    const left = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://a.test/app.js'},
      access,
    );
    const right = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://b.test/app.js'},
      access,
    );
    assert.notEqual(left.mapId, right.mapId);
  });

  it('returns MAP_NOT_FOUND after TTL eviction', async () => {
    const harness = createServiceHarness({cacheTtlMs: 10});
    const parsed = await harness.service.parse(
      {mapContent: BASIC},
      harness.access,
    );
    harness.advance(11);
    assert.throws(
      () =>
        harness.service.lookup({
          mapId: parsed.mapId,
          direction: 'generated_to_original',
          line: 1,
          column: 0,
        }),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'MAP_NOT_FOUND',
    );
  });

  it('evicts the least recently used entry at the entry limit', async () => {
    const {service, access} = createServiceHarness({cacheMaxEntries: 2});
    const first = await service.parse(
      {mapContent: mapWith('a.ts', 'a')},
      access,
    );
    const second = await service.parse(
      {mapContent: mapWith('b.ts', 'b')},
      access,
    );
    service.lookup({
      mapId: first.mapId,
      direction: 'generated_to_original',
      line: 1,
      column: 0,
    });
    await service.parse({mapContent: mapWith('c.ts', 'c')}, access);
    assert.throws(
      () =>
        service.lookup({
          mapId: second.mapId,
          direction: 'generated_to_original',
          line: 1,
          column: 0,
        }),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'MAP_NOT_FOUND',
    );
    assert.equal(service.getCacheStats().entries, 2);
  });

  it('keeps the cache under its byte limit', async () => {
    const {service, access} = createServiceHarness({
      maxBytes: 400,
      cacheMaxBytes: 450,
    });
    await service.parse({mapContent: mapWith('a.ts', 'a'.repeat(250))}, access);
    await service.parse({mapContent: mapWith('b.ts', 'b'.repeat(250))}, access);
    assert.ok(service.getCacheStats().bytes <= 450);
  });
});

describe('SourceMapService facade', () => {
  it('dispatches lookup and bounded diff to cached documents', async () => {
    const {service, access} = createServiceHarness();
    const left = await service.parse({mapContent: BASIC}, access);
    const right = await service.parse(
      {mapContent: mapWith('src/other.ts', 'other')},
      access,
    );
    assert.equal(
      service.lookup({
        mapId: left.mapId,
        direction: 'generated_to_original',
        line: 1,
        column: 0,
      }).match?.line,
      1,
    );
    assert.equal(
      service.diff({
        leftMapId: left.mapId,
        rightMapId: right.mapId,
        mode: 'sources',
        maxChanges: 1,
      }).totalChanges,
      2,
    );
  });

  it('reconstructs only to an explicit or existing task directory', async () => {
    const outputDir = await mkdtemp(
      path.join(os.tmpdir(), 'sourcemap-service-'),
    );
    const {service, access} = createServiceHarness();
    const parsed = await service.parse({mapContent: BASIC}, access);
    await assert.rejects(
      service.reconstructTree(
        {mapId: parsed.mapId, taskId: 'missing', overwrite: false},
        access,
      ),
      (error: unknown) =>
        error instanceof SourceMapError &&
        error.code === 'OUTPUT_PATH_REQUIRED',
    );
    const result = await service.reconstructTree(
      {mapId: parsed.mapId, taskId: 'existing-task', overwrite: false},
      fakeAccess(outputDir),
    );
    assert.equal(
      await readFile(path.join(outputDir, 'src/main.ts'), 'utf8'),
      'export const main = true;\n',
    );
    assert.equal(result.rootDir, outputDir);
  });
});
