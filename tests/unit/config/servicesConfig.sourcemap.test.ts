import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {getSourceMapConfig} from '../../../src/config/servicesConfig.js';
import {SourceMapError} from '../../../src/modules/sourcemap/types.js';

const keys = [
  'SOURCEMAP_MAX_BYTES',
  'SOURCEMAP_CACHE_MAX_BYTES',
  'SOURCEMAP_CACHE_MAX_ENTRIES',
  'SOURCEMAP_CACHE_TTL_MS',
  'SOURCEMAP_FETCH_TIMEOUT_MS',
] as const;

afterEach(() => keys.forEach(key => delete process.env[key]));

describe('getSourceMapConfig', () => {
  it('returns approved defaults', () => {
    assert.deepEqual(getSourceMapConfig(), {
      maxBytes: 20 * 1024 * 1024,
      cacheMaxBytes: 64 * 1024 * 1024,
      cacheMaxEntries: 16,
      cacheTtlMs: 30 * 60 * 1000,
      fetchTimeoutMs: 15_000,
      maxRedirects: 3,
      maxIndexedDepth: 8,
      maxIndexedSections: 1000,
      maxDiffChanges: 2000,
    });
  });

  it('rejects a cache smaller than one map', () => {
    process.env.SOURCEMAP_MAX_BYTES = String(30 * 1024 * 1024);
    process.env.SOURCEMAP_CACHE_MAX_BYTES = String(20 * 1024 * 1024);
    assert.throws(
      getSourceMapConfig,
      (error: unknown) =>
        error instanceof SourceMapError &&
        error.code === 'SOURCEMAP_CONFIG_INVALID',
    );
  });

  it('rejects non-integers, non-positive values, and hard-limit overflow', () => {
    for (const value of ['0', '1.5', String(101 * 1024 * 1024)]) {
      process.env.SOURCEMAP_MAX_BYTES = value;
      assert.throws(getSourceMapConfig, SourceMapError);
    }
  });
});
