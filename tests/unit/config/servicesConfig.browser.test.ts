/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

import {resetRuntimeConfigStore} from '../../../src/config/RuntimeConfigStore.js';
import {
  buildBrowserManagerConfig,
  getBrowserManagerConfig,
} from '../../../src/config/servicesConfig.js';
import type {BrowserManagerConfig} from '../../../src/types/browser.js';

test('getBrowserManagerConfig returns valid BrowserManagerConfig typed from L0', () => {
  const originalEnv = process.env.BROWSER_HEADLESS;
  const prevConfigDir = process.env.BROWSERCLI_CONFIG_DIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcli-svc-cfg-'));
  process.env.BROWSERCLI_CONFIG_DIR = tmpDir;
  resetRuntimeConfigStore({});
  try {
    process.env.BROWSER_HEADLESS = 'true';
    const config: BrowserManagerConfig = getBrowserManagerConfig();
    assert.equal(config.headless, true);
    assert.equal(typeof config, 'object');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.BROWSER_HEADLESS;
    } else {
      process.env.BROWSER_HEADLESS = originalEnv;
    }
    if (prevConfigDir === undefined) {
      delete process.env.BROWSERCLI_CONFIG_DIR;
    } else {
      process.env.BROWSERCLI_CONFIG_DIR = prevConfigDir;
    }
    fs.rmSync(tmpDir, {recursive: true, force: true});
    resetRuntimeConfigStore({});
  }
});

test('buildBrowserManagerConfig respects top-level flat config and overrides defaults', () => {
  try {
    resetRuntimeConfigStore({
      browserUrl: 'http://127.0.0.1:9222',
      headless: false,
      executablePath: 'C:\\Test\\chrome.exe',
      cloak: true,
      jsStealth: true,
    });

    const config = buildBrowserManagerConfig();
    assert.strictEqual(config.browserURL, 'http://127.0.0.1:9222');
    assert.strictEqual(config.headless, false);
    assert.strictEqual(config.executablePath, 'C:\\Test\\chrome.exe');
    assert.strictEqual(config.cloak, true);
    assert.strictEqual(config.jsStealth, true);
  } finally {
    resetRuntimeConfigStore({});
  }
});
