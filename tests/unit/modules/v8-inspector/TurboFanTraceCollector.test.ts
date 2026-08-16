/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {
  collectTurboFanIRFromDir,
  collectTurboFanIRIsolated,
} from '../../../../src/modules/v8-inspector/TurboFanTraceCollector.js';

function createTurboFanJSON(): string {
  return JSON.stringify({
    function: {
      sourceId: 1,
      functionName: 'fixture',
      sourceName: 'fixture.js',
      sourceText: 'function fixture(value) { return value + 1; }',
      startPosition: 0,
      endPosition: 46,
    },
    sources: {},
    inlinings: {},
    phases: [
      {
        name: 'Graph',
        type: 'graph',
        data: {
          nodes: [
            {
              id: 1,
              label: 'Start',
              title: 'Start',
              live: true,
              properties: '',
              opcode: 'Start',
              control: true,
              opinfo: '',
              type: 'control',
            },
          ],
          edges: [],
        },
      },
    ],
  });
}

async function withTempDir<T>(
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'v8-inspector-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

describe('TurboFanTraceCollector', () => {
  it('parses only TurboFan JSON artifacts from an existing directory', async () => {
    await withTempDir(async directory => {
      await writeFile(
        join(directory, 'turbo-fixture.json'),
        createTurboFanJSON(),
      );
      await writeFile(join(directory, 'unrelated.json'), createTurboFanJSON());
      await writeFile(join(directory, 'turbo-fixture.cfg'), 'ignored');

      const result = collectTurboFanIRFromDir(directory);

      assert.equal(result.available, true);
      assert.equal(result.graphCount, 1);
      assert.equal(result.graphs[0]?.function.functionName, 'fixture');
      assert.equal(result.traceDir, directory);
      assert.equal(result.durationMs, null);
    });
  });

  it('does not execute captured page source without an explicit unsafe opt-in', async () => {
    const result = await collectTurboFanIRIsolated({
      functionName: 'fixture',
      sourceSlice: 'function fixture(value) { return value + 1; }',
    });

    assert.equal(result.available, false);
    assert.match(result.reason, /unsafeExecuteCapturedSource/u);
    assert.equal(result.traceDir, null);
  });

  it('routes isolated output through the configured artifact root and cleans failures', async () => {
    await withTempDir(async directory => {
      const originalArtifactsDir = process.env.BROWSER_ARTIFACTS_DIR;
      process.env.BROWSER_ARTIFACTS_DIR = directory;
      try {
        const result = await collectTurboFanIRIsolated(
          {functionName: 'notCallable', sourceSlice: '42'},
          5_000,
          false,
          true,
        );

        assert.equal(result.available, false);
        assert.equal(result.traceDir, null);
        assert.match(result.reason, /Unable to reconstruct/u);

        const temporaryRoot = join(directory, '.tmp');
        await mkdir(temporaryRoot, {recursive: true});
        assert.deepEqual(await readdir(temporaryRoot), []);
      } finally {
        if (originalArtifactsDir === undefined) {
          delete process.env.BROWSER_ARTIFACTS_DIR;
        } else {
          process.env.BROWSER_ARTIFACTS_DIR = originalArtifactsDir;
        }
      }
    });
  });
});
