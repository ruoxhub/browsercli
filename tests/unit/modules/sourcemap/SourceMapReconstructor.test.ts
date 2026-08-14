/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {mkdtemp, readFile, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {SourceMapDocument} from '../../../../src/modules/sourcemap/SourceMapDocument.js';
import {
  normalizeSourcePath,
  SourceMapReconstructor,
} from '../../../../src/modules/sourcemap/SourceMapReconstructor.js';

function documentFor(
  sources: string[],
  sourcesContent: Array<string | null>,
): SourceMapDocument {
  return SourceMapDocument.parse(
    JSON.stringify({
      version: 3,
      sources,
      sourcesContent,
      names: [],
      mappings: '',
    }),
  );
}

describe('SourceMapReconstructor', () => {
  it('normalizes hostile source paths below the output root', () => {
    assert.equal(normalizeSourcePath('../../CON.txt', 0), '_CON.txt');
    assert.equal(
      normalizeSourcePath('webpack:///src/main.ts?token=secret', 1),
      'src/main.ts',
    );
    assert.equal(normalizeSourcePath('C:\\tmp\\..\\aux.js', 2), '_aux.js');
    assert.equal(normalizeSourcePath('', 3), 'source-3');
  });

  it('writes content and the manifest last', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-tree-'));
    const result = await new SourceMapReconstructor().reconstruct(
      documentFor(['src/main.ts'], ['export const main = true;\n']),
      {mapId: 'sm_test', outputDir: root, overwrite: false},
    );
    assert.equal(
      await readFile(path.join(root, 'src/main.ts'), 'utf8'),
      'export const main = true;\n',
    );
    assert.equal(result.written, 1);
    assert.equal(result.missing, 0);
    assert.equal(
      JSON.parse(await readFile(result.manifestPath, 'utf8')).mapId,
      'sm_test',
    );
  });

  it('records missing sources and gives conflicting content unique names', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-collision-'));
    const result = await new SourceMapReconstructor().reconstruct(
      documentFor(
        ['src/a.ts', 'src/./a.ts', 'src/missing.ts'],
        ['one', 'two', null],
      ),
      {mapId: 'sm_test', outputDir: root, overwrite: false},
    );
    assert.equal(result.written, 2);
    assert.equal(result.collisions, 1);
    assert.equal(result.missing, 1);
    assert.equal(result.entries[1]?.status, 'collision');
    assert.match(
      result.entries[1]?.outputPath ?? '',
      /^src\/a~[a-f0-9]{8}\.ts$/,
    );
    assert.equal(result.entries[2]?.status, 'missing');
  });

  it('skips existing files unless overwrite is explicit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-overwrite-'));
    const target = path.join(root, 'src', 'main.ts');
    await new SourceMapReconstructor().reconstruct(
      documentFor(['src/main.ts'], ['first']),
      {mapId: 'sm_first', outputDir: root, overwrite: false},
    );
    const skipped = await new SourceMapReconstructor().reconstruct(
      documentFor(['src/main.ts'], ['second']),
      {mapId: 'sm_second', outputDir: root, overwrite: false},
    );
    assert.equal(skipped.skipped, 1);
    assert.equal(await readFile(target, 'utf8'), 'first');

    const overwritten = await new SourceMapReconstructor().reconstruct(
      documentFor(['src/main.ts'], ['second']),
      {mapId: 'sm_second', outputDir: root, overwrite: true},
    );
    assert.equal(overwritten.written, 1);
    assert.equal(await readFile(target, 'utf8'), 'second');
  });

  it('does not follow an existing symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-link-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-outside-'));
    await symlink(outside, path.join(root, 'src'), 'junction');
    await assert.rejects(
      new SourceMapReconstructor().reconstruct(
        documentFor(['src/main.ts'], ['blocked']),
        {mapId: 'sm_test', outputDir: root, overwrite: false},
      ),
      /symlink/i,
    );
  });

  it('does not overwrite a symlink target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-file-link-'));
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'sourcemap-file-outside-'),
    );
    const marker = path.join(outside, 'marker.ts');
    await writeFile(marker, 'outside');
    await new SourceMapReconstructor().reconstruct(
      documentFor(['placeholder.ts'], ['placeholder']),
      {mapId: 'sm_setup', outputDir: path.join(root, 'tree'), overwrite: false},
    );
    await symlink(outside, path.join(root, 'tree', 'main.ts'), 'junction');
    await assert.rejects(
      new SourceMapReconstructor().reconstruct(
        documentFor(['main.ts'], ['blocked']),
        {mapId: 'sm_test', outputDir: path.join(root, 'tree'), overwrite: true},
      ),
      /symlink/i,
    );
    assert.equal(await readFile(marker, 'utf8'), 'outside');
  });
});
