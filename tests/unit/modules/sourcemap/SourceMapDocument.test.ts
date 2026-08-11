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
});
