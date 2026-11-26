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
      channel: 'beta',
      isolated: false,
      userDataDir: '/tmp/profile',
      acceptInsecureCerts: true,
      proxyServer: 'http://127.0.0.1:8080',
      chromeArg: ['--no-sandbox'],
      ignoreDefaultChromeArg: ['--disable-extensions'],
      wsHeaders: {Authorization: 'Bearer test'},
    });

    const config = buildBrowserManagerConfig();
    assert.strictEqual(config.browserURL, 'http://127.0.0.1:9222');
    assert.strictEqual(config.headless, false);
    assert.strictEqual(config.executablePath, 'C:\\Test\\chrome.exe');
    assert.strictEqual(config.cloak, true);
    assert.strictEqual(config.jsStealth, true);
    assert.strictEqual(config.channel, 'beta');
    assert.strictEqual(config.isolated, false);
    assert.strictEqual(config.userDataDir, '/tmp/profile');
    assert.strictEqual(config.acceptInsecureCerts, true);
    assert.strictEqual(config.proxyServer, 'http://127.0.0.1:8080');
    assert.deepStrictEqual(config.chromeArg, ['--no-sandbox']);
    assert.deepStrictEqual(config.ignoreDefaultChromeArg, [
      '--disable-extensions',
    ]);
    assert.deepStrictEqual(config.wsHeaders, {Authorization: 'Bearer test'});
  } finally {
    resetRuntimeConfigStore({});
  }
});
