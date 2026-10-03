/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {describe, it} from 'node:test';

import {ArtifactStorage} from '../../../src/utils/ArtifactStorage.js';
import {ToolResponseProcessor} from '../../../src/worker/ToolResponse.js';

describe('ArtifactStorage & Reference over Value', () => {
  it('detects when content exceeds threshold', () => {
    const storage = new ArtifactStorage({thresholdBytes: 100});
    assert.strictEqual(storage.shouldOffload({small: 'data'}), false);

    const largeData = {big: 'a'.repeat(200)};
    assert.strictEqual(storage.shouldOffload(largeData), true);
  });

  it('saves large artifact to disk and creates reference metadata with preview', () => {
    const storage = new ArtifactStorage({
      thresholdBytes: 50,
      outputDir: 'artifacts/test-outputs',
    });

    const largeArray = Array.from({length: 100}, (_, i) => ({
      id: i,
      name: `item_${i}`,
      description: 'some long string content to inflate bytes',
    }));

    const ref = storage.createReference('test_tool', largeArray);

    assert.strictEqual(ref._referenceOverValue, true);
    assert.ok(typeof ref.artifactPath === 'string');
    assert.ok(fs.existsSync(ref.artifactPath));
    assert.ok(ref.totalBytes > 50);
    assert.strictEqual(ref.totalItems, 100);
    assert.ok(Array.isArray(ref.preview));
    assert.strictEqual(ref.preview.length, 3);

    // Read file and verify full content is preserved
    const savedContent = JSON.parse(fs.readFileSync(ref.artifactPath, 'utf8'));
    assert.strictEqual(savedContent.length, 100);

    // Clean up test file
    fs.unlinkSync(ref.artifactPath);
  });

  it('ToolResponseProcessor offloads huge structuredContent when threshold exceeded', () => {
    const processor = new ToolResponseProcessor({
      autoOffload: true,
      thresholdBytes: 100,
      outputDir: 'artifacts/test-outputs',
    });

    const smallResult = {success: true, data: 'short'};
    const processedSmall = processor.process({structuredContent: smallResult});
    assert.deepStrictEqual(processedSmall, {structuredContent: smallResult});

    const hugeResult = {
      success: true,
      data: Array.from({length: 50}, (_, i) => `item_${i}_${'x'.repeat(20)}`),
    };
    const processedHuge: any = processor.process({
      structuredContent: hugeResult,
      toolName: 'dump_data',
    });

    assert.ok(processedHuge.structuredContent);
    assert.strictEqual(
      processedHuge.structuredContent._referenceOverValue,
      true,
    );
    assert.ok(fs.existsSync(processedHuge.structuredContent.artifactPath));

    // Clean up
    fs.unlinkSync(processedHuge.structuredContent.artifactPath);
  });
});
