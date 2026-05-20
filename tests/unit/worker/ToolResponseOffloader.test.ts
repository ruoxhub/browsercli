/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {DetailedDataManager} from '../../../src/utils/detailedDataManager.js';
import {ToolResponseOffloader} from '../../../src/worker/ToolResponseOffloader.js';

describe('ToolResponseOffloader', () => {
  afterEach(() => {
    DetailedDataManager.destroy();
  });

  it('handle returns small response unchanged', () => {
    const response = {ok: true};
    const offloader = new ToolResponseOffloader(
      DetailedDataManager.getInstance(),
      1024,
    );

    assert.strictEqual(offloader.handle(response), response);
  });

  it('handle returns detailed-data summary for large response', () => {
    const response = {payload: 'x'.repeat(128)};
    const offloader = new ToolResponseOffloader(
      DetailedDataManager.getInstance(),
      16,
    );

    const result = offloader.handle(response);

    assert.ok(result && typeof result === 'object');
    assert.ok('detailId' in result);
    assert.ok('summary' in result);
    assert.ok('hint' in result);
  });
});
