import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

import {SourceMapDocument} from '../../../../src/modules/sourcemap/SourceMapDocument.js';
import {SourceMapError} from '../../../../src/modules/sourcemap/types.js';

const fixture = (name: string) =>
  readFile(path.join(process.cwd(), 'tests/fixtures/sourcemap', name), 'utf8');

describe('SourceMapDocument.parse', () => {
  it('parses a basic v3 map and reports content coverage', async () => {
    const document = SourceMapDocument.parse(await fixture('basic-v3.json'));
    assert.deepEqual(document.getSummary().sourcesContentCoverage, {
      present: 1,
      missing: 0,
      ratio: 1,
    });
    assert.equal(document.getSummary().indexed, false);
  });

  it('flattens embedded indexed sections', async () => {
    const document = SourceMapDocument.parse(
      await fixture('indexed-embedded-v3.json'),
    );
    assert.equal(document.getSummary().indexed, true);
    assert.equal(document.getSummary().sectionsCount, 2);
    assert.equal(document.getSources().length, 2);
  });

  it('preserves extension metadata without interpreting it', async () => {
    const document = SourceMapDocument.parse(await fixture('metadata-v3.json'));
    const summary = document.getSummary();
    assert.equal(summary.debugId, '8a1f9b89-41d4-4ccb-a785-6c31afc8f962');
    assert.deepEqual(summary.ignoreList, [0]);
    assert.deepEqual(summary.extensions.map(item => item.name).sort(), [
      'x_com_bloomberg_sourcesFunctionMappings',
      'x_scope_info',
    ]);
  });

  it('rejects malformed JSON with a stable code', () => {
    assert.throws(
      () => SourceMapDocument.parse('{'),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'PARSE_FAILED',
    );
  });

  it('maps generated and original positions with public coordinate rules', async () => {
    const document = SourceMapDocument.parse(await fixture('basic-v3.json'));
    const original = document.lookup({
      direction: 'generated_to_original',
      line: 1,
      column: 0,
      bias: 'greatest_lower_bound',
    });
    assert.equal(original.match?.line, 1);
    assert.equal(original.match?.column, 0);
    assert.match(original.match?.source ?? '', /src\/answer\.ts$/);

    const generated = document.lookup({
      direction: 'original_to_generated',
      source: original.match?.source ?? '',
      line: 1,
      column: 0,
      bias: 'least_upper_bound',
    });
    assert.deepEqual(generated.match, {line: 1, column: 0});
  });

  it('returns a successful null match for an unmapped position', async () => {
    const document = SourceMapDocument.parse(await fixture('basic-v3.json'));
    assert.equal(
      document.lookup({
        direction: 'generated_to_original',
        line: 50,
        column: 0,
      }).match,
      null,
    );
  });

  it('reports exact diff totals while bounding details', async () => {
    const left = SourceMapDocument.parse(await fixture('basic-v3.json'));
    const right = SourceMapDocument.parse(
      JSON.stringify({
        version: 3,
        sources: ['one.ts', 'two.ts'],
        sourcesContent: ['one', 'two'],
        names: [],
        mappings: 'AAAA;ACAA',
      }),
    );
    const diff = left.diff(right, {mode: 'mappings', maxChanges: 1});
    assert.equal(diff.truncated, true);
    assert.equal(diff.changes.length, 1);
    assert.ok(diff.totalChanges > diff.changes.length);
  });
});
