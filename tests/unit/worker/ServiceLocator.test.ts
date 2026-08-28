/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import type {Runtime} from '../../../src/runtime.js';
import {ServiceLocator} from '../../../src/worker/ServiceLocator.js';

describe('ServiceLocator.getCaptureEngine', () => {
  it('returns the runtime captureEngine when present', () => {
    const engine = {} as CaptureEngine;
    const runtime = {captureEngine: engine} as unknown as Runtime;
    assert.strictEqual(new ServiceLocator(runtime).getCaptureEngine(), engine);
  });

  it('returns undefined when the runtime mock lacks the service', () => {
    const locator = new ServiceLocator({} as unknown as Runtime);
    assert.strictEqual(locator.getCaptureEngine(), undefined);
  });

  it('returns undefined with no runtime at all', () => {
    assert.strictEqual(new ServiceLocator().getCaptureEngine(), undefined);
  });
});
