/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {CollectedFileRegistry} from '../../../../src/modules/collector/CollectedFileRegistry.js';

describe('CollectedFileRegistry', () => {
  describe('basic add/has', () => {
    it('adds a file and reports has(url) true', () => {
      const registry = new CollectedFileRegistry({maxFilesCacheSize: 100});
      const file = {
        url: 'https://example.com/a.js',
        content: 'var a = 1;',
        size: 11,
        type: 'external' as const,
      };
      assert.strictEqual(registry.has('https://example.com/a.js'), false);
      registry.addFile('https://example.com/a.js', file);
      assert.strictEqual(registry.has('https://example.com/a.js'), true);
    });

    it('hasUrl tracks URL dedup separately from file cache', () => {
      const registry = new CollectedFileRegistry();
      registry.addUrl('https://example.com/b.js');
      assert.strictEqual(registry.hasUrl('https://example.com/b.js'), true);
      assert.strictEqual(
        registry.getFile('https://example.com/b.js'),
        undefined,
      );
    });
  });

  describe('FIFO eviction', () => {
    it('evicts oldest file when cache limit reached', () => {
      const registry = new CollectedFileRegistry({maxFilesCacheSize: 2});
      registry.addFile('1.js', {
        url: '1.js',
        content: '',
        size: 0,
        type: 'external',
      });
      registry.addFile('2.js', {
        url: '2.js',
        content: '',
        size: 0,
        type: 'external',
      });
      registry.addFile('3.js', {
        url: '3.js',
        content: '',
        size: 0,
        type: 'external',
      });
      // 1.js should be evicted (FIFO)
      assert.strictEqual(registry.getFile('1.js'), undefined);
      assert.strictEqual(registry.getFile('2.js')?.url, '2.js');
      assert.strictEqual(registry.getFile('3.js')?.url, '3.js');
    });
  });

  describe('buildFileMetadata', () => {
    it('returns undefined when not truncated and not combo URL', () => {
      const registry = new CollectedFileRegistry();
      assert.strictEqual(
        registry.buildFileMetadata(false, 100, 100, 'https://example.com/a.js'),
        undefined,
      );
    });

    it('includes truncation metadata when truncated=true', () => {
      const registry = new CollectedFileRegistry();
      const meta = registry.buildFileMetadata(
        true,
        500,
        200,
        'https://example.com/big.js',
      );
      assert.strictEqual(meta?.truncated, true);
      assert.strictEqual(meta?.originalSize, 500);
      assert.strictEqual(meta?.truncatedSize, 200);
    });
  });

  describe('hasReachedFileLimit', () => {
    it('returns true when count >= MAX_FILES_PER_COLLECT', () => {
      const registry = new CollectedFileRegistry({maxFilesPerCollect: 5});
      assert.strictEqual(registry.hasReachedFileLimit(4), false);
      assert.strictEqual(registry.hasReachedFileLimit(5), true);
      assert.strictEqual(registry.hasReachedFileLimit(6), true);
    });
  });

  describe('clear / clearUrls / clearFiles', () => {
    it('clear removes both URLs and files', () => {
      const registry = new CollectedFileRegistry();
      registry.addFile('a.js', {
        url: 'a.js',
        content: '',
        size: 0,
        type: 'external',
      });
      registry.clear();
      assert.strictEqual(registry.has('a.js'), false);
      assert.strictEqual(registry.getStats().cacheSize, 0);
      assert.strictEqual(registry.getStats().urlCount, 0);
    });

    it('clearUrls only clears URL set, keeps file cache', () => {
      const registry = new CollectedFileRegistry();
      registry.addFile('a.js', {
        url: 'a.js',
        content: '',
        size: 0,
        type: 'external',
      });
      registry.clearUrls();
      assert.strictEqual(registry.hasUrl('a.js'), false);
      assert.strictEqual(registry.getFile('a.js')?.url, 'a.js');
    });

    it('clearFiles only clears file cache, keeps URL set; returns count', () => {
      const registry = new CollectedFileRegistry();
      registry.addFile('a.js', {
        url: 'a.js',
        content: '',
        size: 0,
        type: 'external',
      });
      registry.addFile('b.js', {
        url: 'b.js',
        content: '',
        size: 0,
        type: 'external',
      });
      const count = registry.clearFiles();
      assert.strictEqual(count, 2);
      assert.strictEqual(registry.getFile('a.js'), undefined);
      assert.strictEqual(registry.hasUrl('a.js'), true);
    });
  });

  describe('getFilesByPattern', () => {
    it('returns warning when cache is empty', () => {
      const registry = new CollectedFileRegistry();
      const result = registry.getFilesByPattern('.*');
      assert.strictEqual(result.files.length, 0);
      assert.strictEqual(result.warning !== undefined, true);
    });

    it('returns INVALID_PATTERN error for bad regex', () => {
      const registry = new CollectedFileRegistry();
      registry.addFile('a.js', {
        url: 'a.js',
        content: '',
        size: 0,
        type: 'external',
      });
      const result = registry.getFilesByPattern('(');
      assert.strictEqual(result.error, 'INVALID_PATTERN');
    });

    it('matches files by regex', () => {
      const registry = new CollectedFileRegistry();
      registry.addFile('https://x.com/main.js', {
        url: 'https://x.com/main.js',
        content: 'a',
        size: 1,
        type: 'external',
      });
      registry.addFile('https://x.com/vendor.js', {
        url: 'https://x.com/vendor.js',
        content: 'b',
        size: 1,
        type: 'external',
      });
      const result = registry.getFilesByPattern('main');
      assert.strictEqual(result.matched, 1);
      assert.strictEqual(result.returned, 1);
      assert.strictEqual(result.files[0]?.url, 'https://x.com/main.js');
    });
  });

  describe('getTopPriorityFiles', () => {
    it('ranks crypto/encrypt URLs higher than vendor URLs', () => {
      const registry = new CollectedFileRegistry();
      registry.addFile('https://x.com/vendor.js', {
        url: 'https://x.com/vendor.js',
        content: 'x'.repeat(100),
        size: 100,
        type: 'external',
      });
      registry.addFile('https://x.com/encrypt.js', {
        url: 'https://x.com/encrypt.js',
        content: 'y'.repeat(100),
        size: 100,
        type: 'external',
      });
      const result = registry.getTopPriorityFiles(2);
      assert.strictEqual(result.files[0]?.url, 'https://x.com/encrypt.js');
    });
  });

  describe('getCollectedFilesSummary / getFileByUrl', () => {
    it('returns summary without content', () => {
      const registry = new CollectedFileRegistry();
      registry.addFile('a.js', {
        url: 'a.js',
        content: 'code',
        size: 4,
        type: 'external',
      });
      const summaries = registry.getCollectedFilesSummary();
      assert.strictEqual(summaries.length, 1);
      assert.strictEqual(summaries[0]?.url, 'a.js');
      assert.strictEqual(summaries[0]?.size, 4);
      assert.strictEqual(
        (summaries[0] as {content?: string}).content,
        undefined,
      );
    });

    it('getFileByUrl returns null for missing URL', () => {
      const registry = new CollectedFileRegistry();
      assert.strictEqual(registry.getFileByUrl('missing.js'), null);
    });
  });
});
