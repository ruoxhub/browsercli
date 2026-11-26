/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  buildBrowserConnectOptions,
  hasExplicitBrowserFlags,
  serializeStartFlags,
} from '../../../src/cli/startOptions.js';
import {validateGlobalConfig} from '../../../src/config/schema.js';

describe('startOptions', () => {
  it('serializes yargs argv and fills config defaults without duplicating CLI overrides', () => {
    const flags = serializeStartFlags(
      {
        categoryInput: true,
        categoryNavigation: false,
        screenshotFormat: 'webp',
        proxyServer: 'http://127.0.0.1:8080',
        chromeArg: ['--no-sandbox'],
        blockedUrlPattern: ['*://ad.example.com/*'],
        watchConfig: true,
        headless: true,
        browserUrl: 'http://127.0.0.1:9999',
        json: true,
        force: true,
      },
      {
        headless: 'false',
        cloak: 'true',
        browserUrl: 'http://127.0.0.1:9222',
        executablePath: 'C:/Chrome/chrome.exe',
      },
    );

    assert.ok(flags.includes('--category-input'));
    assert.ok(flags.includes('--no-category-navigation'));
    assert.ok(flags.includes('--screenshot-format=webp'));
    assert.ok(flags.includes('--proxy-server=http://127.0.0.1:8080'));
    assert.ok(flags.includes('--chrome-arg=--no-sandbox'));
    assert.ok(flags.includes('--blocked-url-pattern=*://ad.example.com/*'));
    assert.ok(flags.includes('--watch-config'));
    assert.ok(flags.includes('--headless'));
    assert.ok(flags.includes('--cloak'));
    assert.ok(flags.includes('--browser-url=http://127.0.0.1:9999'));
    assert.ok(!flags.some(f => f.includes('9222')));
    assert.ok(flags.includes('--executablePath=C:/Chrome/chrome.exe'));
    assert.ok(!flags.includes('--json'));
    assert.ok(!flags.includes('--force'));
  });

  it('detects explicit browser flags accurately', () => {
    assert.equal(hasExplicitBrowserFlags({json: true}), false);
    assert.equal(hasExplicitBrowserFlags({channel: 'stable'}), true);
    assert.equal(hasExplicitBrowserFlags({headless: true}), true);
    assert.equal(hasExplicitBrowserFlags({browserUrl: 'http://127.0.0.1:9222'}), true);
  });

  it('builds and validates browser.connect options with CLI > env > config precedence', () => {
    const prevUrl = process.env.BROWSER_URL;
    const prevHeadless = process.env.BROWSER_HEADLESS;
    process.env.BROWSER_URL = 'http://127.0.0.1:9555';
    process.env.BROWSER_HEADLESS = 'false';

    try {
      const fromEnv = buildBrowserConnectOptions(
        {},
        {browserUrl: 'http://127.0.0.1:9222', headless: 'true'},
      );
      assert.equal(fromEnv.browserURL, 'http://127.0.0.1:9555');
      assert.equal(fromEnv.headless, false);

      const fromCli = buildBrowserConnectOptions(
        {
          browserUrl: '127.0.0.1:9888',
          viewport: '1280x720',
          chromeArg: ['--no-sandbox,--disable-gpu'],
          acceptInsecureCerts: true,
        },
        {browserUrl: 'http://127.0.0.1:9222'},
      );
      assert.equal(fromCli.browserURL, 'http://127.0.0.1:9888');
      assert.deepEqual(fromCli.viewport, {width: 1280, height: 720});
      assert.deepEqual(fromCli.chromeArg, ['--no-sandbox', '--disable-gpu']);
      assert.equal(fromCli.acceptInsecureCerts, true);
    } finally {
      if (prevUrl === undefined) delete process.env.BROWSER_URL;
      else process.env.BROWSER_URL = prevUrl;
      if (prevHeadless === undefined) delete process.env.BROWSER_HEADLESS;
      else process.env.BROWSER_HEADLESS = prevHeadless;
    }
  });

  it('rejects conflicting targets and invalid values', () => {
    assert.throws(
      () =>
        buildBrowserConnectOptions({
          browserUrl: 'http://127.0.0.1:9222',
          wsEndpoint: 'ws://127.0.0.1:9222',
        }),
      /互斥/,
    );
    assert.throws(
      () => buildBrowserConnectOptions({browserUrl: 'ftp://host'}),
      /必须使用/,
    );
    assert.throws(
      () => buildBrowserConnectOptions({viewport: '1280'}),
      /宽x高/,
    );
    assert.throws(
      () => buildBrowserConnectOptions({wsHeaders: '{"Authorization":1}'}),
      /字符串键值对象/,
    );
    assert.throws(
      () => buildBrowserConnectOptions({channel: 'invalid-browser'}),
      /不支持的浏览器 channel/,
    );
  });

  it('validates migrated fields in GlobalConfigSchema', () => {
    const valid = validateGlobalConfig({
      categoryInput: false,
      screenshotFormat: 'webp',
      maxNavigationSaved: 5,
      watchConfig: true,
    });
    assert.equal(valid.categoryInput, false);
    assert.equal(valid.screenshotFormat, 'webp');
    assert.equal(valid.maxNavigationSaved, 5);
    assert.equal(valid.watchConfig, true);
  });
});
