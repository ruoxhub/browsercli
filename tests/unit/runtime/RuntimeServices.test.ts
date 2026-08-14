/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {PageController} from '../../../src/modules/collector/PageController.js';
import {RuntimeServices} from '../../../src/runtime/RuntimeServices.js';

describe('RuntimeServices', () => {
  it('returns stable analyzer instances', () => {
    const services = new RuntimeServices({} as PageController);

    assert.strictEqual(services.getAnalyzer(), services.getAnalyzer());
    assert.strictEqual(services.getLLMService(), services.getLLMService());
  });

  it('does not create wasm collector until requested', () => {
    const services = new RuntimeServices({} as PageController);

    assert.doesNotThrow(() => new RuntimeServices({} as PageController));
    assert.strictEqual(services.getWasmAnalyzer(), services.getWasmAnalyzer());
  });

  it('creates SourceMapService lazily and reuses it', () => {
    const services = new RuntimeServices({} as PageController);
    const first = services.getSourceMapService();
    assert.equal(services.getSourceMapService(), first);
  });
});
