/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {parseArgs} from '../../../src/cli/args-parser.js';
import {connectOptions} from '../../../src/cli/commands/browser.js';
import {spawnFlagsFromArgv} from '../../../src/cli/sessionArgs.js';
import {validateGlobalConfig} from '../../../src/config/schema.js';

describe('Migrated chrome-devtools start options', () => {
  it('recognizes all migrated flags in DAEMON_SPAWN_FLAGS and DAEMON_VALUE_FLAGS', () => {
    const rawArgs = [
      '--categoryInput',
      '--categoryNavigation=false',
      '--no-categoryPerformance',
      '--screenshotFormat=webp',
      '--proxyServer=http://127.0.0.1:8080',
      '--chromeArg=--no-sandbox',
      '--blockedUrlPattern=*://ad.example.com/*',
      '--watchConfig',
    ];

    const spawnFlags = spawnFlagsFromArgv(rawArgs);
    assert.ok(spawnFlags.includes('--categoryInput'));
    assert.ok(spawnFlags.includes('--categoryNavigation=false'));
    assert.ok(spawnFlags.includes('--no-categoryPerformance'));
    assert.ok(spawnFlags.includes('--screenshotFormat=webp'));
    assert.ok(spawnFlags.includes('--proxyServer=http://127.0.0.1:8080'));
    assert.ok(spawnFlags.includes('--chromeArg=--no-sandbox'));
    assert.ok(spawnFlags.includes('--blockedUrlPattern=*://ad.example.com/*'));
    assert.ok(spawnFlags.includes('--watchConfig'));
  });

  it('parses connectOptions with camelCase, kebab-case and short aliases', () => {
    const parsedShort = parseArgs(['-u', 'http://127.0.0.1:9222']);
    const optsShort = connectOptions(parsedShort.flags);
    assert.strictEqual(optsShort.browserURL, 'http://127.0.0.1:9222');

    const parsedWs = parseArgs([
      '-w',
      'ws://127.0.0.1:9222/devtools/browser/1',
    ]);
    const optsWs = connectOptions(parsedWs.flags);
    assert.strictEqual(
      optsWs.wsEndpoint,
      'ws://127.0.0.1:9222/devtools/browser/1',
    );

    const parsedLaunch = parseArgs([
      '-e',
      'C:/Chrome/chrome.exe',
      '--proxyServer=http://proxy:8080',
      '--chromeArg=--no-sandbox,--disable-gpu',
      '--acceptInsecureCerts',
      '--headless',
    ]);
    const optsLaunch = connectOptions(parsedLaunch.flags);
    assert.strictEqual(optsLaunch.executablePath, 'C:/Chrome/chrome.exe');
    assert.strictEqual(optsLaunch.proxyServer, 'http://proxy:8080');
    assert.deepStrictEqual(optsLaunch.chromeArg, [
      '--no-sandbox',
      '--disable-gpu',
    ]);
    assert.strictEqual(optsLaunch.acceptInsecureCerts, true);
    assert.strictEqual(optsLaunch.headless, true);
  });

  it('validates migrated fields in GlobalConfigSchema', () => {
    const valid = validateGlobalConfig({
      categoryInput: false,
      categoryNavigation: true,
      screenshotFormat: 'webp',
      screenshotQuality: 80,
      screenshotMaxWidth: 1920,
      screenshotMaxHeight: 1080,
      blockedUrlPattern: ['*://doubleclick.net/*'],
      allowedUrlPattern: ['https://example.com/*'],
      redactNetworkHeaders: true,
      maxNavigationSaved: 5,
      proxyServer: 'http://127.0.0.1:8888',
      chromeArg: ['--test-flag'],
      watchConfig: true,
    });

    assert.strictEqual(valid.categoryInput, false);
    assert.strictEqual(valid.screenshotFormat, 'webp');
    assert.strictEqual(valid.screenshotQuality, 80);
    assert.strictEqual(valid.maxNavigationSaved, 5);
    assert.deepStrictEqual(valid.blockedUrlPattern, ['*://doubleclick.net/*']);
    assert.strictEqual(valid.watchConfig, true);
  });
});
