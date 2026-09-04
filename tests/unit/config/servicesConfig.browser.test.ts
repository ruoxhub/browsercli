
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {getBrowserManagerConfig} from '../../../src/config/servicesConfig.js';
import type {BrowserManagerConfig} from '../../../src/types/browser.js';

test('getBrowserManagerConfig returns valid BrowserManagerConfig typed from L0', () => {
  const originalEnv = process.env.CHROME_HEADLESS;
  try {
    process.env.CHROME_HEADLESS = 'true';
    const config: BrowserManagerConfig = getBrowserManagerConfig();
    assert.equal(config.headless, true);
    assert.equal(typeof config, 'object');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CHROME_HEADLESS;
    } else {
      process.env.CHROME_HEADLESS = originalEnv;
    }
  }
});
